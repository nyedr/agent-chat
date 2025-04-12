import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import { VectorStoreManager } from "./vector-store-manager";

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

const LearningSchema = z.object({
  text: z
    .string()
    .describe(
      "Insightful learning including implications/critique/comparison etc."
    ),
  source: z
    .string()
    .describe(
      "The specific Source *URL* from the context snippet the learning was derived from."
    ),
});

const InsightResultSchema = z.object({
  answer: z
    .string()
    .describe(
      "Comprehensive, nuanced answer to the sub-query based *only* on the provided context."
    ),
  learnings: z
    .array(LearningSchema)
    .describe("Array of key learning objects extracted from the context."),
  analysis: z
    .string()
    .describe(
      "In-depth analysis of connections, contradictions, gaps, or methodological considerations found *within* the provided context snippets."
    ),
  followUpQuestions: z
    .array(z.string())
    .describe(
      "List of 2-3 specific, critical follow-up questions stemming from the analysis of the context."
    ),
});

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

      const temperature = 0.5;

      const initialPrompt = this.createInsightPrompt(
        context,
        specificQuery,
        originalQuery
      );

      const { object: initialResult } = await generateObject({
        model: this.llmProvider.chatModel(this.modelId),
        schema: InsightResultSchema,
        prompt: initialPrompt,
        temperature: temperature,
      });

      const initialLearnings = initialResult.learnings;

      if (initialLearnings.length <= 1) {
        return initialResult;
      }

      // --- Populate titles from metadata ---
      // Create a quick lookup map from the context chunks provided to the LLM
      const metadataMap = new Map<string, { title?: string }>();
      if (this.vectorStoreManager) {
        // Ensure we have the source of context
        const relevantChunks = await this.vectorStoreManager.search(
          specificQuery,
          10
        );
        relevantChunks.forEach((chunk) => {
          if (chunk.metadata?.url && typeof chunk.metadata.url === "string") {
            metadataMap.set(chunk.metadata.url, {
              title: chunk.metadata.title,
            });
          }
        });
      }

      // Map to the internal Learning interface, populating title from metadata
      const mappedLearnings: Learning[] = initialResult.learnings.map((l) => {
        const metadata = metadataMap.get(l.source);
        return {
          text: l.text,
          source: l.source,
          title:
            typeof metadata?.title === "string" ? metadata.title : undefined,
        };
      });

      // --- Return Result (No Synthesis) ---
      return {
        ...initialResult,
        learnings: mappedLearnings,
      };
    } catch (error) {
      console.error("Error generating insights:", error);

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
    return `You are an expert research analyst. Analyze the following context snippets related to the sub-query "${specificQuery}" (part of a larger research on "${originalQuery}").

Context Snippets:
${context}

Based ONLY on the provided context snippets:

1. Answer the sub-query: "${specificQuery}" with a comprehensive synthesis of the information.

2. Extract key learnings (aim for 3-5 distinct points if possible). For each learning object:
   - Focus on **actionable insights, implications, limitations, critical perspectives, assumptions, methodological considerations, or comparisons** mentioned in the sources, not just surface-level facts.
   - Ensure each learning is distinct and adds unique value.
   - Provide the specific 'Source URL' from the context snippet it came from in the 'source' field.
   - **Do NOT include the title in the JSON output.**

3. Perform deep analysis by:
   - Identifying connections, contradictions, or gaps between the different source snippets.
   - Evaluating the strength or limitations of evidence presented.
   - Discussing potential biases or alternative interpretations suggested within the sources.
   - Contextualizing the information within broader frameworks mentioned in the snippets.

4. Generate 2-3 specific follow-up questions that would lead to a more comprehensive understanding, including:
   - Questions about contradictory perspectives or unexplored angles.
   - Questions that challenge assumptions present in the current sources.
   - Questions that would fill critical knowledge gaps.

Return your response in this EXACT JSON format. The 'learnings' array MUST only contain objects with 'text' and 'source' fields:
{
  "answer": "(Your synthesized answer here)",
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
  "analysis": "(Your in-depth analysis here)",
  "followUpQuestions": ["(Follow-up question 1?)", "(Follow-up question 2?)"]
}`;
  }
}
