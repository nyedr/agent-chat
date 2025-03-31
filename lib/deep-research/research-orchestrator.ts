import { DataStreamWriter, generateText } from "ai";
import type FirecrawlApp from "@mendable/firecrawl-js";

import { SearchModule } from "./modules/search";
import { SourceCuratorModule } from "./modules/source-curator";
import {
  ContentScraperModule,
  ProcessedContent,
} from "./modules/content-scraper";
import { VectorStoreManager } from "./modules/vector-store-manager";
import { InsightGeneratorModule, Learning } from "./modules/insight-generator";
import { FactualVerificationModule } from "./modules/factual-verification";
import { ReportGeneratorModule } from "./modules/report-generator";
import { WorkflowConfig } from "./types";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { ModelsByCapability } from "../ai/models";

/**
 * Final research result
 */
export interface ResearchResult {
  query: string;
  insights: string[];
  factualAnswer: string;
  finalReport: string;
  sources: Record<string, string>;
  metrics: {
    timeElapsed: number;
    iterationsCompleted: number;
    sourcesExamined: number;
  };
}

/**
 * Central orchestrator for managing the deep research workflow.
 */
export class ResearchOrchestrator {
  private searchModule: SearchModule;
  private curatorModule: SourceCuratorModule;
  private scraperModule: ContentScraperModule;
  private vectorStore: VectorStoreManager;
  private insightModule: InsightGeneratorModule;
  private verificationModule: FactualVerificationModule;
  private reportModule: ReportGeneratorModule;
  private dataStream: DataStreamWriter | null;
  private llmProvider: OpenAICompatibleProvider<string, string, string>; // Store LLM provider for potential usage
  private models: ModelsByCapability; // Store model ID for potential usage

  /**
   * @param firecrawlApp - FirecrawlApp instance for web functionality
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param modelId - ID of the model to use
   * @param dataStream - Optional stream for progress updates
   */
  constructor(
    firecrawlApp: FirecrawlApp,
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    models: ModelsByCapability,
    dataStream: DataStreamWriter | null = null
  ) {
    // Store LLM provider and model ID
    this.llmProvider = llmProvider;
    this.models = models;
    this.dataStream = dataStream;

    // Initialize all modules
    this.searchModule = new SearchModule(firecrawlApp);
    this.curatorModule = new SourceCuratorModule(llmProvider, models.light);
    this.scraperModule = new ContentScraperModule(firecrawlApp);

    // Initialize vector store for semantic search and context retrieval
    this.vectorStore = new VectorStoreManager();

    // Initialize insight generation and connect to vector store
    this.insightModule = new InsightGeneratorModule(
      llmProvider,
      models.default,
      this.vectorStore
    );

    this.verificationModule = new FactualVerificationModule(
      llmProvider,
      models.light
    );
    this.reportModule = new ReportGeneratorModule(
      llmProvider,
      models.reasoning
    );
  }

  /**
   * Main method to run the deep research workflow.
   *
   * @param query - Research query to investigate
   * @param config - Workflow configuration
   * @returns Promise with research result
   */
  async runDeepResearchWorkflow(
    query: string,
    config: WorkflowConfig
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    const timeLimit = config.timeout || 4.5 * 60 * 1000; // Default 4.5 minutes

    // Research state tracking
    const researchState = {
      allSources: {} as Record<string, string>,
      allLearnings: [] as Learning[], // Structured learnings with citations
      factualAnswer: "",
      currentDepth: 0,
      maxDepth: config.maxDepth,
      completedSteps: 0,
      totalSteps: config.maxDepth * 5, // Initial estimate - will be refined
      iterations: [] as Array<{
        query: string;
        context: string;
        insights: string[];
      }>,
      shouldContinue: true,
      researchQueue: [] as string[], // Queue for tracking subqueries
    };

    // Initialize progress tracking
    if (this.dataStream) {
      this.dataStream.writeData({
        type: "progress-init",
        content: {
          maxDepth: config.maxDepth,
          totalSteps: researchState.totalSteps,
        },
      });
    }

    try {
      // Plan initial research by generating subqueries
      const initialSubQueries = await this._planInitialResearch(
        query,
        researchState
      );

      // Initialize the research queue with the generated subqueries
      researchState.researchQueue = [...initialSubQueries];

      // Refine the total steps estimate based on the number of subqueries
      const estimatedQueriesPerDepth =
        1 + initialSubQueries.length / config.maxDepth;
      const stepsPerQuery = 5; // search, curate, scrape, analyze, insight generation
      researchState.totalSteps = Math.ceil(
        config.maxDepth * estimatedQueriesPerDepth * stepsPerQuery + 2 // factual verification + report generation
      );

      // Update progress with refined estimate
      this.updateProgress(
        researchState,
        "activity-delta",
        `Research plan: exploring ${initialSubQueries.length} research angles across ${config.maxDepth} levels`
      );

      // Start with the original query if no subqueries were generated
      let currentQuery = researchState.researchQueue.shift() || query;

      // Clear the vector store before starting
      await this.vectorStore.clear();

      // Main research loop
      while (
        researchState.currentDepth < researchState.maxDepth &&
        researchState.shouldContinue &&
        Date.now() - startTime < timeLimit
      ) {
        researchState.currentDepth++;

        this.updateProgress(
          researchState,
          "depth",
          `Starting research depth ${researchState.currentDepth} of ${researchState.maxDepth}`
        );

        // Phase 1: Search for and curate sources
        const sourceResults = await this.retrieveAndCurateSources(
          currentQuery,
          researchState
        );

        if (sourceResults.length === 0) {
          this.updateProgress(
            researchState,
            "warning",
            `No valid sources found for "${currentQuery}"`
          );

          // Try to get the next query from the queue
          if (researchState.researchQueue.length > 0) {
            currentQuery = researchState.researchQueue.shift()!;
            continue; // Skip to the next query
          } else if (researchState.currentDepth < researchState.maxDepth) {
            // If no more queries but not at max depth, try a reformulation
            currentQuery = this.reformulateQuery(query, researchState);
            continue;
          } else {
            // No more queries and at max depth, stop research
            this.updateProgress(
              researchState,
              "warning",
              "No more research angles to explore, concluding research."
            );
            researchState.shouldContinue = false;
            break;
          }
        }

        // Phase 2: Scrape and convert content
        const processedContents = await this.scrapeAndConvertContent(
          sourceResults,
          researchState
        );

        if (processedContents.length === 0) {
          this.updateProgress(
            researchState,
            "warning",
            "No content could be extracted from sources."
          );

          // Try the next query in the queue
          if (researchState.researchQueue.length > 0) {
            currentQuery = researchState.researchQueue.shift()!;
            continue;
          } else {
            // No more queries, either reformulate or stop
            if (researchState.currentDepth < researchState.maxDepth) {
              currentQuery = this.reformulateQuery(query, researchState);
            } else {
              researchState.shouldContinue = false;
            }
            continue;
          }
        }

        // Phase 3: Add documents to vector store for semantic search
        await this.addDocumentsToVectorStore(processedContents, researchState);

        // Phase 4: Generate insights using the vector store context
        const insightResult = await this.aggregateContextAndGenerateInsights(
          currentQuery, // Now using the specific query
          query, // Original query for context
          researchState
        );

        // Store the generated insights and research artifacts
        researchState.allLearnings.push(...insightResult.learnings);

        // Update iteration tracking
        researchState.iterations.push({
          query: currentQuery,
          context: "Vectorized context", // No longer storing raw context
          insights: insightResult.learnings.map(
            (learning: Learning) => learning.text
          ),
        });

        // Add any follow-up questions to the research queue
        const followUps = insightResult.followUpQuestions;
        if (followUps && followUps.length > 0) {
          // Only add new questions that we haven't explored yet
          const newQuestions = followUps.filter(
            (q) =>
              !researchState.researchQueue.includes(q) &&
              !researchState.iterations.some((iter) => iter.query === q)
          );

          // Add new questions to the front of the queue
          researchState.researchQueue.unshift(...newQuestions.slice(0, 3));

          this.updateProgress(
            researchState,
            "activity-delta",
            `Added ${newQuestions.length} new research angles to explore`
          );
        }

        // Get the next query from the queue, or stop if queue is empty
        if (researchState.researchQueue.length > 0) {
          currentQuery = researchState.researchQueue.shift()!;
        } else {
          // If we've explored all queries, we can stop early
          if (
            researchState.currentDepth >= Math.ceil(researchState.maxDepth / 2)
          ) {
            this.updateProgress(
              researchState,
              "activity-delta",
              "All research angles explored successfully"
            );
            researchState.shouldContinue = false;
          } else {
            // Generate variations of the original query to continue research
            const variations = this.generateQueryVariations(
              query,
              researchState.allLearnings.map(
                (learning: Learning) => learning.text
              )
            );
            researchState.researchQueue.push(...variations);
            currentQuery = researchState.researchQueue.shift()!;
          }
        }
      }

      // Phase 5: Factual verification
      this.updateProgress(
        researchState,
        "activity-delta",
        "Verifying factual accuracy of research findings"
      );

      // Use the factual verification module to verify the findings
      const verificationResult =
        await this.verificationModule.verifyFactualAccuracy(
          researchState.allLearnings, // Now passing structured learnings
          query
        );

      researchState.factualAnswer = verificationResult;
      researchState.completedSteps++;

      // Phase 6: Report generation
      this.updateProgress(
        researchState,
        "activity-delta",
        "Generating comprehensive research report"
      );

      // Generate the final report using the structured learnings
      const finalReport = await this.reportModule.generateFinalReport(
        researchState.allLearnings,
        query
      );

      researchState.completedSteps++;

      // Prepare and return the final result
      const result: ResearchResult = {
        query,
        insights: researchState.allLearnings.map(
          (learning: Learning) => learning.text
        ),
        factualAnswer: researchState.factualAnswer,
        finalReport,
        sources: researchState.allSources,
        metrics: {
          timeElapsed: Date.now() - startTime,
          iterationsCompleted: researchState.currentDepth,
          sourcesExamined: Object.keys(researchState.allSources).length,
        },
      };

      // Final progress update
      this.updateProgress(
        researchState,
        "complete",
        `Research completed with ${
          researchState.allLearnings.length
        } insights from ${Object.keys(researchState.allSources).length} sources`
      );

      return result;
    } catch (error) {
      console.error("Error in deep research workflow:", error);

      // Handle error and return partial result if available
      if (this.dataStream) {
        this.dataStream.writeData({
          type: "error",
          content: {
            message: `Research error: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Return partial results if we have any
      if (researchState.allLearnings.length > 0) {
        return {
          query,
          insights: researchState.allLearnings.map(
            (learning: Learning) => learning.text
          ),
          factualAnswer:
            researchState.factualAnswer ||
            "Research was interrupted before verification.",
          finalReport:
            `# Partial Research Report: ${query}\n\n` +
            `*Note: Research was interrupted due to an error.*\n\n` +
            `## Findings So Far\n\n` +
            researchState.allLearnings
              .map((learning: Learning, idx) => `${idx + 1}. ${learning.text}`)
              .join("\n\n"),
          sources: researchState.allSources,
          metrics: {
            timeElapsed: Date.now() - startTime,
            iterationsCompleted: researchState.currentDepth,
            sourcesExamined: Object.keys(researchState.allSources).length,
          },
        };
      }

      // If we have no insights, return an error report
      return {
        query,
        insights: [],
        factualAnswer: "Research failed to complete due to an error.",
        finalReport: `# Research Error Report\n\nThe research on "${query}" encountered an error and could not be completed.\n\nError: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        sources: {},
        metrics: {
          timeElapsed: Date.now() - startTime,
          iterationsCompleted: researchState.currentDepth,
          sourcesExamined: 0,
        },
      };
    } finally {
      // Always clean up resources
      await this.vectorStore.clear();
    }
  }

  /**
   * Phase 1: Retrieves and curates sources based on the query.
   *
   * @param query - Research query
   * @param state - Current research state
   * @returns Promise with curated search results
   */
  private async retrieveAndCurateSources(query: string, state: any) {
    this.updateProgress(
      state,
      "activity-delta",
      `Searching for sources on: ${query}`
    );

    // Check if we should use semantic variations for better coverage
    let searchResults = [];

    // If we have accumulated some insights, use them to enhance the search
    if (state.allLearnings.length > 0 && state.currentDepth > 1) {
      // Generate semantic variations of the query based on insights
      const queryVariations = this.generateQueryVariations(
        query,
        state.allLearnings.map((learning: Learning) => learning.text)
      );

      // Search with all variations and merge results
      this.updateProgress(
        state,
        "activity-delta",
        `Searching with ${queryVariations.length} query variations`
      );

      searchResults = await this.searchModule.searchMultiple(
        queryVariations,
        undefined, // no year filter
        5, // results per query
        true // remove duplicates
      );
    } else {
      // Standard search with just the single query
      searchResults = await this.searchModule.searchWeb(query);
    }

    state.completedSteps++;

    this.updateProgress(
      state,
      "activity-delta",
      `Found ${searchResults.length} potential sources`
    );

    // Track the sources
    searchResults.forEach((result) => {
      state.allSources[result.title] = result.url;
    });

    // Determine how many sources to curate based on depth
    // Deeper explorations can be more focused with fewer sources
    const maxResults = Math.max(10 - state.currentDepth, 3); // At least 3, decreasing with depth

    // Curate the sources
    const curatedResults = await this.curatorModule.curateSources(
      searchResults,
      query,
      maxResults
    );
    state.completedSteps++;

    this.updateProgress(
      state,
      "activity-delta",
      `Selected ${curatedResults.length} most relevant sources`
    );

    return curatedResults;
  }

  /**
   * Generates semantic variations of a query based on accumulated insights.
   *
   * @param query - Original query
   * @param insights - Array of insights from previous research
   * @returns Array of query variations
   */
  private generateQueryVariations(query: string, insights: string[]): string[] {
    // Always include the original query
    const variations = [query];

    // Extract key terms from insights (simple approach)
    const recentInsights = insights.slice(-3); // Use only the most recent insights

    // For each insight, create a query variation combining the original query with the insight
    recentInsights.forEach((insight) => {
      // Extract key phrases from the insight (simplified approach)
      const keyPhrases = this.extractKeyPhrases(insight);

      // Add variations that combine the query with key phrases
      keyPhrases.forEach((phrase) => {
        if (
          phrase.length > 5 &&
          !query.toLowerCase().includes(phrase.toLowerCase())
        ) {
          variations.push(`${query} ${phrase}`);
        }
      });
    });

    // Ensure we don't have too many variations
    return variations.slice(0, 5); // Limit to 5 variations
  }

  /**
   * Extracts key phrases from text (simplified approach).
   *
   * @param text - Text to extract phrases from
   * @returns Array of key phrases
   */
  private extractKeyPhrases(text: string): string[] {
    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    // Extract noun phrases (simplified approach - just take substantial segments)
    const phrases: string[] = [];

    for (const sentence of sentences) {
      // Remove common stop words and split by common separators
      const cleaned = sentence
        .replace(
          /\b(the|and|or|in|on|at|a|an|of|for|to|with|by|is|are|was|were)\b/gi,
          " "
        )
        .trim();

      const fragments = cleaned.split(/[,;:\(\)]/);

      // Add fragments that are substantial enough to be meaningful
      fragments.forEach((fragment) => {
        const trimmed = fragment.trim();
        if (
          trimmed.length > 10 &&
          trimmed.split(" ").length >= 2 &&
          trimmed.split(" ").length <= 5
        ) {
          phrases.push(trimmed);
        }
      });
    }

    return phrases;
  }

  /**
   * Phase 2: Scrapes and converts content from sources.
   *
   * @param sources - Curated search results
   * @param state - Current research state
   * @returns Promise with array of processed content
   */
  private async scrapeAndConvertContent(sources: any[], state: any) {
    this.updateProgress(
      state,
      "activity-delta",
      `Extracting content from ${sources.length} sources`
    );

    // Extract URLs to scrape
    const urls = sources.map((source) => source.url);

    // Scrape content from URLs, now handling different document types
    const processedContents = await this.scraperModule.scrapeUrls(urls);
    state.completedSteps++;

    this.updateProgress(
      state,
      "activity-delta",
      `Successfully extracted content from ${
        processedContents.length
      } sources (${
        processedContents.filter((c) => c.type !== "web").length
      } documents, ${
        processedContents.filter((c) => c.type === "web").length
      } web pages)`
    );

    return processedContents;
  }

  /**
   * Adds documents to the vector store for semantic search.
   *
   * @param processedContents - Array of processed content objects
   * @param state - Current research state
   */
  private async addDocumentsToVectorStore(
    processedContents: ProcessedContent[],
    state: any
  ) {
    this.updateProgress(
      state,
      "activity-delta",
      `Adding ${processedContents.length} documents to vector store`
    );

    // Track sources for citation
    processedContents.forEach((content) => {
      if (content.url && content.text) {
        let sourceName = content.url;

        // Try to extract a more readable source name
        if (content.metadata && content.metadata.title) {
          sourceName = content.metadata.title;
        } else {
          // Try to extract domain name for web content
          try {
            const url = new URL(content.url);
            sourceName = url.hostname;
          } catch (e) {
            // If URL parsing fails, keep the original URL
          }
        }

        state.allSources[content.url] = sourceName;
      }
    });

    // Add documents to vector store
    await this.vectorStore.addDocuments(processedContents);
    state.completedSteps++;

    this.updateProgress(
      state,
      "activity-delta",
      `Documents processed and indexed for semantic search`
    );
  }

  /**
   * Phase 4: Generates insights using vector store context.
   *
   * @param specificQuery - Current specific query being researched
   * @param originalQuery - Original research query
   * @param state - Current research state
   * @returns Object with answer, learnings, analysis, and follow-up questions
   */
  private async aggregateContextAndGenerateInsights(
    specificQuery: string,
    originalQuery: string,
    state: any
  ) {
    this.updateProgress(
      state,
      "activity-delta",
      "Generating insights from research"
    );

    // Generate insights using the specific query via the enhanced insight module
    const insightResult = await this.insightModule.generateInsights(
      specificQuery,
      originalQuery
    );
    state.completedSteps++;

    this.updateProgress(
      state,
      "activity-delta",
      `Generated ${insightResult.learnings.length} research insights`
    );

    return insightResult;
  }

  /**
   * Reformulates a query when it doesn't yield good results.
   *
   * @param query - Original query
   * @param state - Current research state
   * @returns Reformulated query
   */
  private reformulateQuery(query: string, state: any): string {
    // Simple reformulation - could be expanded with LLM-based reformulation
    const prefixes = [
      "latest research on",
      "detailed information about",
      "comprehensive guide to",
      "expert analysis of",
      "current understanding of",
    ];

    // Get a prefix we haven't used yet
    const usedQueries = state.iterations.map((i: any) => i.query);
    const availablePrefixes = prefixes.filter(
      (p) => !usedQueries.some((q: string) => q.startsWith(p))
    );

    if (availablePrefixes.length > 0) {
      const prefix = availablePrefixes[0];
      return `${prefix} ${query}`;
    }

    // If all prefixes used, just return original
    return query;
  }

  /**
   * Updates progress through the data stream.
   *
   * @param state - Current research state
   * @param type - Type of update
   * @param message - Progress message
   */
  private updateProgress(state: any, type: string, message: string): void {
    if (!this.dataStream) {
      return;
    }

    this.dataStream.writeData({
      type,
      content: {
        message,
        current: state.currentDepth,
        max: state.maxDepth,
        completedSteps: state.completedSteps,
        totalSteps: state.totalSteps,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Plans the initial research by generating diverse subqueries to explore.
   *
   * @param query - Main research query
   * @param state - Current research state
   * @returns Promise with array of generated subqueries
   */
  private async _planInitialResearch(
    query: string,
    state: any
  ): Promise<string[]> {
    this.updateProgress(
      state,
      "activity-delta",
      "Planning research strategy..."
    );

    // Optional: Perform a quick preliminary search for context
    const preliminarySearchResults = await this.searchModule.searchWeb(query);
    state.completedSteps++;

    // If we found some results, use them to provide context for the planning (limit to top 3)
    let prelimContext = "";
    const topResults = preliminarySearchResults.slice(0, 3);
    if (topResults.length > 0) {
      prelimContext =
        "Based on initial search results:\n" +
        topResults.map((r) => `- ${r.title}: ${r.snippet}`).join("\n");
    }

    const planningPrompt = `You are a research strategist planning a comprehensive investigation on the topic: "${query}".

${prelimContext}

Generate 3-5 specific sub-queries or research angles that will help explore this topic thoroughly. 
These should cover different aspects, perspectives, or dimensions of the main query.
The sub-queries should be diverse and complementary, not redundant.

Return ONLY a JSON array of strings, with each string being a clear, searchable sub-query.
Example: ["First specific sub-query", "Second specific sub-query", "Third specific sub-query"]`;

    try {
      // Use a direct LLM call with the planning prompt
      const result = await generateText({
        model: this.llmProvider.chatModel(this.models.reasoning),
        prompt: planningPrompt,
      });

      // Parse the response to extract the JSON array
      try {
        // Try to parse the JSON array
        let subQueries: string[] = [];

        // Clean the response to extract just the JSON array
        const jsonText = result.text
          .trim()
          .replace(/```json\s+/g, "")
          .replace(/\s+```/g, "")
          .replace(/```/g, "");

        const parsedResult = JSON.parse(jsonText);

        // Validate that it's an array of strings
        if (
          Array.isArray(parsedResult) &&
          parsedResult.every((item) => typeof item === "string")
        ) {
          subQueries = parsedResult;
        } else {
          // If not a valid array of strings, fall back to the follow-up questions approach
          console.log(
            "LLM response was not a valid array of strings, falling back to insightModule"
          );
          const insightResult = await this.insightModule.generateInsights(
            prelimContext || query,
            query
          );
          subQueries = insightResult.followUpQuestions;
        }

        if (subQueries.length > 0) {
          this.updateProgress(
            state,
            "activity-delta",
            `Generated ${subQueries.length} research angles: ${subQueries.join(
              ", "
            )}`
          );
          return subQueries;
        }

        // If no sub-queries, fall back to the original query
        return [query];
      } catch (parseError) {
        console.error("Error parsing planning LLM response:", parseError);
        console.log("Falling back to insightModule for research planning");

        // Fall back to the insight module approach if parsing fails
        const insightResult = await this.insightModule.generateInsights(
          prelimContext || query,
          query
        );

        // Use the follow-up questions as our sub-queries
        if (insightResult.followUpQuestions.length > 0) {
          this.updateProgress(
            state,
            "activity-delta",
            `Generated ${
              insightResult.followUpQuestions.length
            } research angles: ${insightResult.followUpQuestions.join(", ")}`
          );
          return insightResult.followUpQuestions;
        }

        // Last resort fallback
        return [query];
      }
    } catch (error) {
      console.error("Error during research planning:", error);
      this.updateProgress(state, "error", "Failed to plan research strategy.");
      return [query]; // Fallback to the original query
    }
  }
}
