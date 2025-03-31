import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { SearchResult } from "./search";
import { z } from "zod";
import { normalizeUrl } from "../../utils";

/**
 * Schema for curated source result from LLM
 */
const CuratedSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  relevance: z.number().min(0).max(10),
  reasoning: z.string(),
  snippet: z.string().optional(),
  date: z.string().nullable().optional(),
  source: z.string().optional(),
});

/**
 * Schema for curation response from LLM
 */
const CurationResponseSchema = z.object({
  sources: z.array(CuratedSourceSchema),
  explanation: z.string(),
});

/**
 * Curator module for filtering and ranking search results.
 */
export class SourceCuratorModule {
  private llmProvider: OpenAICompatibleProvider<string, string, string>;
  private modelId: string;

  /**
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param modelId - ID of the model to use for curation
   */
  constructor(
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    modelId: string
  ) {
    this.llmProvider = llmProvider;
    this.modelId = modelId;
  }

  /**
   * Curates a list of search results by filtering and ranking them by relevance.
   * Uses LLM for intelligent ranking and filtering based on relevance to query.
   *
   * @param sources - Array of SearchResult objects from the search module
   * @param query - Original query string for relevance checking
   * @param maxResults - Maximum number of results to return
   * @returns Filtered and ranked array of SearchResult objects
   */
  async curateSources(
    sources: SearchResult[],
    query: string,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    if (!sources || sources.length === 0) {
      console.log("No sources to curate");
      return [];
    }

    console.log(`Curating ${sources.length} sources for query: "${query}"`);

    try {
      // Step 1: Remove duplicates (by URL normalization)
      const uniqueSources = this.removeDuplicates(sources);

      // If we have few sources, just use heuristic ranking
      if (uniqueSources.length <= 3) {
        console.log("Too few sources, using heuristic ranking only");
        return this.scoreSources(uniqueSources, query).slice(0, maxResults);
      }

      // Step 2: Format sources for LLM curation
      const formattedSources = this.formatSourcesForLLM(uniqueSources);

      // Step 3: Create curation prompt
      const prompt = this.createCurationPrompt(formattedSources, query);

      // Step 4: Call LLM for curation
      const result = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt,
      });

      // Step 5: Parse and validate LLM response
      const curatedSources = await this.parseCurationResponse(
        result.text,
        uniqueSources
      );

      // If parsing failed, fall back to heuristic-based curation
      if (!curatedSources || curatedSources.length === 0) {
        console.log("LLM curation failed, falling back to heuristic ranking");
        return this.scoreSources(uniqueSources, query).slice(0, maxResults);
      }

      console.log(`LLM successfully curated ${curatedSources.length} sources`);

      // Take the top N results
      return curatedSources.slice(0, maxResults);
    } catch (error) {
      console.error("Error during source curation:", error);

      // Fall back to traditional scoring if LLM curation fails
      const fallbackResults = this.scoreSources(sources, query).slice(
        0,
        maxResults
      );
      console.log(
        `Falling back to heuristic-based curation, returning ${fallbackResults.length} sources`
      );

      return fallbackResults;
    }
  }

  /**
   * Creates a prompt for LLM-based source curation.
   *
   * @param sources - Formatted string of sources
   * @param query - Original research query
   * @returns Prompt string for LLM
   */
  private createCurationPrompt(sources: string, query: string): string {
    return `You are a research assistant tasked with curating sources for the research query: "${query}".

Below are search results that need to be evaluated. Your task is to:
1. Evaluate each source for relevance to the query (on a scale of 0-10)
2. Filter out low-quality or irrelevant sources
3. Provide a brief reasoning for each kept source
4. Rank the sources by relevance and trustworthiness

Here are the sources to evaluate:

${sources}

Return your response in the following JSON format:
{
  "sources": [
    {
      "title": "Source title",
      "url": "Source URL",
      "relevance": 9,
      "reasoning": "Brief explanation of why this source is relevant",
      "snippet": "Original snippet text (preserved from input)",
      "date": "Publication date (if available)",
      "source": "Domain or publisher (if available)"
    }
    // Add more sources in descending order of relevance
  ],
  "explanation": "Brief explanation of your curation strategy"
}

Only include sources with a relevance score of 6 or higher. Focus on sources that:
- Directly address the research query
- Come from reputable and authoritative sources
- Contain comprehensive information
- Are recent (unless historical information is specifically relevant)
- Provide unique perspectives or information

Do not include sources that are:
- Clearly irrelevant to the query
- Low-quality or unreliable
- Duplicative of information in higher-ranked sources
- Commercial or promotional without substantial informational value

Return the JSON with no additional text, comments, or explanations outside the JSON structure.`;
  }

  /**
   * Parses the LLM's curation response and returns curated sources.
   *
   * @param response - Raw LLM response text
   * @param originalSources - Original source array (for fallback)
   * @returns Promise with curated and ranked SearchResult array
   */
  private async parseCurationResponse(
    response: string,
    originalSources: SearchResult[]
  ): Promise<SearchResult[]> {
    try {
      // Clean potential markdown code fences and trim whitespace
      const cleanedResponse = response.trim().replace(/```json\s*|\s*```/g, "");

      // Parse the potentially cleaned JSON
      const parsedResponse = JSON.parse(cleanedResponse);

      // Validate with Zod schema
      const validationResult = CurationResponseSchema.safeParse(parsedResponse);

      if (!validationResult.success) {
        console.error(
          "LLM response validation failed:",
          validationResult.error.format() // Use .format() for better error logging
        );
        // Log the raw response for debugging
        console.error("Raw LLM Response causing validation failure:", response);
        return []; // Return empty array on validation failure
      }

      const data = validationResult.data;

      // Map validated sources back to SearchResult format
      return data.sources.map((curatedSource) => {
        const originalSource = originalSources.find(
          (src) => normalizeUrl(src.url) === normalizeUrl(curatedSource.url)
        );
        const validatedDate =
          curatedSource.date === null ? undefined : curatedSource.date;

        if (!originalSource) {
          return {
            title: curatedSource.title,
            url: curatedSource.url,
            snippet: curatedSource.snippet || "",
            date: validatedDate,
            source: curatedSource.source || new URL(curatedSource.url).hostname,
            relevance: curatedSource.relevance / 10,
          };
        }

        return {
          ...originalSource,
          date: validatedDate ?? originalSource.date,
          relevance: curatedSource.relevance / 10,
        };
      });
    } catch (error) {
      console.error("Failed to parse LLM curation response:", error);
      // Log the raw response that caused the parse error
      console.error("Raw LLM Response causing parse failure:", response);
      return []; // Return empty array on parse failure
    }
  }

  /**
   * Formats sources for LLM-based curation.
   *
   * @param sources - Array of SearchResult objects
   * @returns Formatted string of sources for LLM consumption
   */
  formatSourcesForLLM(sources: SearchResult[]): string {
    if (!sources.length) {
      return "No sources available.";
    }

    // Format each source with its details
    return sources
      .map((source, i) => {
        return `Source ${i + 1}:

Title: ${source.title}
URL: ${source.url}
Snippet: ${source.snippet}
${source.date ? `Date: ${source.date}` : ""}
${source.source ? `Source: ${source.source}` : ""}`;
      })
      .join("\n\n");
  }

  /**
   * Removes duplicate search results based on normalized URLs.
   *
   * @param sources - Array of SearchResult objects
   * @returns Array of unique SearchResult objects
   */
  private removeDuplicates(sources: SearchResult[]): SearchResult[] {
    const seenUrls = new Set<string>();
    return sources.filter((source) => {
      // Normalize URL for comparison (remove trailing slashes, etc.)
      const normalizedUrl = normalizeUrl(source.url);

      if (seenUrls.has(normalizedUrl)) {
        return false;
      }

      seenUrls.add(normalizedUrl);
      return true;
    });
  }

  /**
   * Scores and ranks search results based on relevance to query.
   * Used as fallback when LLM curation is not available or fails.
   *
   * @param sources - Array of SearchResult objects
   * @param query - Original query string
   * @returns Sorted array of SearchResult objects
   */
  private scoreSources(sources: SearchResult[], query: string): SearchResult[] {
    // Extract query keywords for relevance scoring
    const queryKeywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((kw) => kw.length > 3); // Only consider significant words

    // Create a copy with scores
    const sourcesWithScores = sources.map((source) => {
      // Use existing relevance score if available, otherwise calculate it
      const score =
        source.relevance ?? this.calculateRelevanceScore(source, queryKeywords);
      return { ...source, relevanceScore: score };
    });

    // Sort by relevance score (descending)
    return sourcesWithScores
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .map(({ relevanceScore, ...rest }) => rest); // Remove the score from the result
  }

  /**
   * Calculates a relevance score for a search result based on query keywords.
   *
   * @param source - SearchResult object
   * @param queryKeywords - Array of query keywords
   * @returns Numerical score indicating relevance
   */
  private calculateRelevanceScore(
    source: SearchResult,
    queryKeywords: string[]
  ): number {
    let score = 0;

    // Title match (higher weight)
    const titleLower = source.title.toLowerCase();
    queryKeywords.forEach((keyword) => {
      if (titleLower.includes(keyword)) {
        score += 10;
      }
    });

    // Snippet match
    const snippetLower = source.snippet.toLowerCase();
    queryKeywords.forEach((keyword) => {
      if (snippetLower.includes(keyword)) {
        score += 5;
      }
    });

    // Date recency bonus (if available)
    if (source.date) {
      try {
        const date = new Date(source.date);
        const now = new Date();
        const yearsDiff = now.getFullYear() - date.getFullYear();

        // Give higher scores to more recent sources
        if (yearsDiff === 0) {
          score += 15; // Current year
        } else if (yearsDiff <= 2) {
          score += 10; // Last 2 years
        } else if (yearsDiff <= 5) {
          score += 5; // Last 5 years
        }
      } catch (e) {
        // Invalid date format, ignore
      }
    }

    // Domain authority heuristic
    // This is a simple approximation - in a real system, you would use a more
    // sophisticated domain authority metric
    const domain = source.source || "";
    if (
      domain.includes(".edu") ||
      domain.includes(".gov") ||
      domain.includes("wikipedia.org")
    ) {
      score += 8; // Higher trust for educational, governmental, or Wikipedia domains
    }

    return score;
  }
}
