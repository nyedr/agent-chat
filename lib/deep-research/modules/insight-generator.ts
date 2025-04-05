import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { VectorStoreManager } from "./vector-store-manager";
import cosineSimilarity from "compute-cosine-similarity";

/**
 * Interface for a learning with source citation
 */
export interface Learning {
  text: string;
  source?: string; // URL or Title
  title?: string; // The title of the source page, if available
}

/**
 * Result from insight generation
 */
export interface InsightResult {
  answer: string;
  learnings: Learning[];
  analysis: string;
  followUpQuestions: string[];
}

/**
 * Module for generating insights from research context.
 */
export class InsightGeneratorModule {
  private llmProvider: OpenAICompatibleProvider<string, string, string>;
  private modelId: string;
  private vectorStoreManager?: VectorStoreManager;

  /**
   * Creates a new InsightGeneratorModule.
   *
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param modelId - ID of the model to use
   * @param vectorStoreManager - Optional vector store for enhanced context retrieval
   */
  constructor(
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    modelId: string,
    vectorStoreManager?: VectorStoreManager
  ) {
    this.llmProvider = llmProvider;
    this.modelId = modelId;
    this.vectorStoreManager = vectorStoreManager;
  }

  /**
   * Sets the vector store manager after construction.
   *
   * @param vectorStoreManager - Vector store manager for context retrieval
   */
  setVectorStoreManager(vectorStoreManager: VectorStoreManager): void {
    this.vectorStoreManager = vectorStoreManager;
  }

  /**
   * Generates insights from research context.
   *
   * @param specificQuery - Specific query to analyze
   * @param originalQuery - Original research query (may be different)
   * @returns Promise with refined insight result
   */
  async generateInsights(
    specificQuery: string,
    originalQuery: string = specificQuery
  ): Promise<InsightResult> {
    try {
      let context = "";

      // If we have a vector store manager, use it to get relevant context
      if (this.vectorStoreManager) {
        const relevantChunks = await this.vectorStoreManager.search(
          specificQuery,
          10
        );
        if (relevantChunks.length > 0) {
          // Format the chunks with source information
          context = this.formatContextWithMetadata(relevantChunks);
        }
      }

      // If we didn't get any context from vector store, use the provided context
      if (
        !context.trim() &&
        typeof specificQuery === "string" &&
        specificQuery.length > 200
      ) {
        // Assume specificQuery contains the context text if it's long enough
        context = specificQuery;
        specificQuery = originalQuery;
      }

      // Create the initial prompt
      const initialPrompt = this.createInsightPrompt(
        context,
        specificQuery,
        originalQuery
      );

      // 1. Generate initial insights
      const initialResult = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt: initialPrompt,
      });

      // 2. Parse initial response
      const parsedResult = this.parseInsightResponse(
        initialResult.text,
        specificQuery
      );
      const initialLearnings = parsedResult.learnings;

      if (initialLearnings.length <= 1) {
        // No need to refine if 0 or 1 learning
        return parsedResult;
      }

      // --- 3. Synthesis/Refinement Layer ---
      console.log(
        `Synthesizing ${initialLearnings.length} initial learnings...`
      );
      const refinedLearnings = await this.synthesizeLearnings(initialLearnings);
      console.log(
        `Refined down to ${refinedLearnings.length} synthesized learnings.`
      );

      // Return the result with refined learnings
      return {
        ...parsedResult,
        learnings: refinedLearnings,
      };
      // --- End Synthesis/Refinement Layer ---
    } catch (error) {
      console.error("Error generating insights:", error);

      // Return a minimal result in case of error
      return {
        answer: `Error analyzing research for "${specificQuery}": ${error}`,
        learnings: [],
        analysis: "Analysis could not be completed due to an error.",
        followUpQuestions: [],
      };
    }
  }

  /**
   * Formats context with metadata for LLM.
   *
   * @param chunks - Array of context chunks with metadata
   * @returns Formatted context string
   */
  private formatContextWithMetadata(
    chunks: Array<{
      text: string;
      metadata: Record<string, any>;
      score?: number;
    }>
  ): string {
    return chunks
      .map((chunk, i) => {
        const title = chunk.metadata.title || "Unnamed Source";
        const url = chunk.metadata.url || "Unknown Source";
        const relevance = chunk.score
          ? ` (Relevance: ${(chunk.score * 100).toFixed(1)}%)`
          : "";

        return `Source Doc ${i + 1}: ${title}${relevance}
URL: ${url}

${chunk.text}`;
      })
      .join("\n\n---\n\n");
  }

  /**
   * Creates the prompt for insight generation.
   *
   * @param context - Research context
   * @param specificQuery - Specific query to analyze
   * @param originalQuery - Original research query
   * @returns Prompt string
   */
  private createInsightPrompt(
    context: string,
    specificQuery: string,
    originalQuery: string
  ): string {
    return `You are an expert research analyst with critical thinking skills. Analyze the following context snippets related to the sub-query "${specificQuery}" (part of a larger research on "${originalQuery}").

Context Snippets:
${context}

Based ONLY on the provided context snippets:

1. Answer the sub-query: "${specificQuery}" with a comprehensive synthesis of the information.

2. Extract key learnings (aim for 5-7 distinct points if possible). For each learning:
   - Focus on **actionable insights, implications, limitations, critical perspectives, assumptions, methodological considerations, or comparisons** mentioned in the sources, not just surface-level facts.
   - Ensure each learning is distinct and adds unique value.
   - **Explicitly cite the source URL or Title** mentioned in the context snippet it came from for *each* learning.

3. Perform deep analysis by:
   - Identifying connections, contradictions, or gaps between the different source snippets.
   - Evaluating the strength or limitations of evidence presented.
   - Discussing potential biases or alternative interpretations suggested within the sources.
   - Contextualizing the information within broader frameworks mentioned in the snippets.

4. Generate 2-3 specific follow-up questions that would lead to a more comprehensive understanding, including:
   - Questions about contradictory perspectives or unexplored angles.
   - Questions that challenge assumptions present in the current sources.
   - Questions that would fill critical knowledge gaps.

Return your response in this EXACT JSON format:
{
  "answer": "Your comprehensive, nuanced answer to the sub-query...",
  "learnings": [
    { 
      "text": "Insightful learning including implications/critique/comparison...", 
      "source": "[Source Title/URL from context]" 
    },
    { 
      "text": "Another distinct insightful learning...", 
      "source": "[Source Title/URL from context]" 
    }
  ],
  "analysis": "In-depth analysis of connections/contradictions/gaps/methodological considerations...",
  "followUpQuestions": ["Critical question 1?", "Critical question 2?", "Critical question 3?"]
}`;
  }

  /**
   * Parses the LLM response into structured insight result.
   *
   * @param response - Raw LLM response
   * @param query - Original query (for fallback)
   * @returns Structured insight result
   */
  private parseInsightResponse(response: string, query: string): InsightResult {
    try {
      // Try to extract JSON object from the response
      let jsonMatch = response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        // Try to parse the JSON
        const parsedResponse = JSON.parse(jsonMatch[0]);

        // Validate the required fields
        if (
          typeof parsedResponse.answer === "string" &&
          Array.isArray(parsedResponse.learnings) &&
          typeof parsedResponse.analysis === "string" &&
          Array.isArray(parsedResponse.followUpQuestions)
        ) {
          // Validate and clean learnings
          const learnings = parsedResponse.learnings
            .filter(
              (learning: any) =>
                typeof learning === "object" &&
                typeof learning.text === "string" &&
                typeof learning.source === "string"
            )
            .map((learning: any) => ({
              text: learning.text.trim(),
              source: learning.source.trim(),
              title: learning.metadata?.title,
            }));

          // Validate and clean follow-up questions
          const followUpQuestions = parsedResponse.followUpQuestions
            .filter((q: any) => typeof q === "string" && q.trim().length > 0)
            .map((q: any) => q.trim());

          return {
            answer: parsedResponse.answer.trim(),
            learnings,
            analysis: parsedResponse.analysis.trim(),
            followUpQuestions,
          };
        }
      }

      // If JSON parsing fails, try to extract insights manually
      console.warn(
        "Failed to parse insight response as JSON, falling back to manual extraction"
      );

      // Simple fallback extraction
      const answer =
        this.extractSection(
          response,
          ["answer:", "answer", "1."],
          ["learning", "key learning", "2."]
        ) || `Analysis of research for "${query}"`;

      const learningText = this.extractSection(
        response,
        ["learning", "key learning", "2."],
        ["analysis", "connection", "contradiction", "3."]
      );
      const learnings = this.extractLearningsWithSources(learningText);

      const analysis =
        this.extractSection(
          response,
          ["analysis", "connection", "contradiction", "3."],
          ["follow-up", "question", "4."]
        ) || "No detailed analysis available.";

      const questionsText = this.extractSection(
        response,
        ["follow-up", "question", "4."],
        []
      );
      const followUpQuestions = this.extractQuestions(questionsText);

      return {
        answer,
        learnings,
        analysis,
        followUpQuestions,
      };
    } catch (error) {
      console.error("Error parsing insight response:", error);

      // Return minimal fallback
      return {
        answer: `Analysis of research for "${query}"`,
        learnings: [],
        analysis: "No detailed analysis available.",
        followUpQuestions: [],
      };
    }
  }

  /**
   * Extracts a section from text based on start and end markers.
   *
   * @param text - Text to extract from
   * @param startMarkers - Array of possible start markers
   * @param endMarkers - Array of possible end markers
   * @returns Extracted section or empty string
   */
  private extractSection(
    text: string,
    startMarkers: string[],
    endMarkers: string[]
  ): string {
    // Convert text to lowercase for case-insensitive matching
    const lowerText = text.toLowerCase();

    // Find the start position
    let startPos = -1;
    for (const marker of startMarkers) {
      const pos = lowerText.indexOf(marker.toLowerCase());
      if (pos !== -1 && (startPos === -1 || pos < startPos)) {
        startPos = pos;
      }
    }

    if (startPos === -1) {
      return "";
    }

    // Find the end position
    let endPos = text.length;
    for (const marker of endMarkers) {
      const pos = lowerText.indexOf(marker.toLowerCase(), startPos + 1);
      if (pos !== -1 && pos < endPos) {
        endPos = pos;
      }
    }

    // Extract and clean the section
    return text.substring(startPos, endPos).trim();
  }

  /**
   * Extracts learnings with sources from text.
   *
   * @param text - Text containing learnings with source citations
   * @returns Array of learnings with sources
   */
  private extractLearningsWithSources(text: string): Learning[] {
    if (!text) {
      return [];
    }

    const learnings: Learning[] = [];

    // Split by bullet points or numbered list items
    const items = text.split(/(?:\r?\n|^)(?:[-*•]|\d+\.)\s+/);

    for (const item of items) {
      if (!item.trim()) continue;

      // Try to find source citations like [Source: X] or (Source: X)
      const sourceMatch = item.match(
        /\[(Source|From):?\s*([^\]]+)\]|\((Source|From):?\s*([^)]+)\)/i
      );

      if (sourceMatch) {
        const source = sourceMatch[2] || sourceMatch[4];
        // Remove the source citation from the text
        const learningText = item
          .replace(
            /\[(Source|From):?\s*([^\]]+)\]|\((Source|From):?\s*([^)]+)\)/i,
            ""
          )
          .trim();

        learnings.push({
          text: learningText,
          source,
          title: sourceMatch[2] || sourceMatch[4],
        });
      } else {
        // If no explicit source, check if there's a colon separator
        const colonSplit = item.split(/:\s+/);
        if (colonSplit.length >= 2) {
          // Assume first part is source, rest is learning
          const source = colonSplit[0].trim();
          const learningText = colonSplit.slice(1).join(": ").trim();

          learnings.push({
            text: learningText,
            source,
            title: source,
          });
        } else {
          // No clear source, use generic source
          learnings.push({
            text: item.trim(),
            source: "Research Context",
            title: "Research Context",
          });
        }
      }
    }

    return learnings;
  }

  /**
   * Extracts questions from text.
   *
   * @param text - Text containing questions
   * @returns Array of questions
   */
  private extractQuestions(text: string): string[] {
    if (!text) {
      return [];
    }

    // Split by bullet points, numbered list items, or newlines
    const items = text.split(/(?:\r?\n|^)(?:[-*•]|\d+\.)\s+/);

    return items
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.endsWith("?"));
  }

  /**
   * Synthesizes a list of learnings to remove redundancy and combine related points.
   *
   * @param learnings - The initial list of learnings.
   * @returns A list of synthesized learnings.
   */
  private async synthesizeLearnings(
    learnings: Learning[]
  ): Promise<Learning[]> {
    if (!this.vectorStoreManager) {
      console.warn("VectorStoreManager not available, skipping synthesis.");
      return learnings;
    }

    try {
      const textsToEmbed = learnings.map((l) => l.text);
      const embeddings = await this.vectorStoreManager.getEmbeddings(
        textsToEmbed
      );

      if (embeddings.length !== learnings.length) {
        console.error(
          "Mismatch between learnings and generated embeddings count."
        );
        return learnings;
      }

      const clusters: Learning[][] = [];
      const visited = new Set<number>();
      const SIMILARITY_THRESHOLD = 0.85; // Adjust threshold as needed

      // Simple threshold-based clustering
      for (let i = 0; i < learnings.length; i++) {
        if (visited.has(i)) continue;

        const currentCluster: Learning[] = [learnings[i]];
        visited.add(i);

        for (let j = i + 1; j < learnings.length; j++) {
          if (visited.has(j)) continue;

          const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
          if (similarity && similarity >= SIMILARITY_THRESHOLD) {
            currentCluster.push(learnings[j]);
            visited.add(j);
          }
        }
        clusters.push(currentCluster);
      }

      console.log(`Formed ${clusters.length} clusters.`);

      // Synthesize learnings within each cluster using an LLM call
      const synthesizedLearnings: Learning[] = [];
      for (const cluster of clusters) {
        if (cluster.length === 1) {
          synthesizedLearnings.push(cluster[0]); // Keep single learnings as is
        } else {
          // Use LLM to synthesize multiple learnings
          const synthesisPrompt = this.createSynthesisPrompt(cluster);
          const synthesisResult = await generateText({
            model: this.llmProvider.chatModel(this.modelId),
            prompt: synthesisPrompt,
          });

          // Basic parsing of synthesis result (assuming simple text output)
          const synthesizedText = synthesisResult.text.trim();
          // Combine sources/titles from the cluster
          const combinedSources = Array.from(
            new Set(cluster.map((l) => l.source).filter((s) => !!s))
          );
          const combinedTitles = Array.from(
            new Set(cluster.map((l) => l.title).filter((t) => !!t))
          );

          if (synthesizedText) {
            synthesizedLearnings.push({
              text: synthesizedText,
              // Use first source/title as representative, or combine if needed
              source: combinedSources[0] || "Multiple Sources",
              title: combinedTitles[0] || undefined,
            });
          }
        }
      }

      return synthesizedLearnings;
    } catch (error) {
      console.error("Error during learning synthesis:", error);
      return learnings; // Return original learnings if synthesis fails
    }
  }

  /**
   * Creates a prompt for synthesizing multiple related learnings.
   *
   * @param cluster - An array of related Learning objects.
   * @returns Prompt string for synthesis.
   */
  private createSynthesisPrompt(cluster: Learning[]): string {
    const learningTexts = cluster
      .map((l, i) => {
        const sourceInfo = l.source ? ` (Source: ${l.source})` : "";
        return `${i + 1}. ${l.text}${sourceInfo}`;
      })
      .join("\n");

    return `You are a concise research analyst. The following points are closely related or potentially redundant. Synthesize them into a single, comprehensive, and nuanced point that captures the core insight without losing important details or contradicting perspectives. Retain citations if present in the original points.

Related Points:
${learningTexts}

Synthesized Point (Output only the synthesized text):`;
  }
}
