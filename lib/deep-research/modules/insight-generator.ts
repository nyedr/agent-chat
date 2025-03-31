import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { VectorStoreManager } from "./vector-store-manager";

/**
 * Interface for a learning with source citation
 */
export interface Learning {
  text: string;
  source: string; // URL or Title
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
   * @returns Promise with insight result
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

      // Create the prompt
      const prompt = this.createInsightPrompt(
        context,
        specificQuery,
        originalQuery
      );

      // Generate insights
      const result = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt,
      });

      // Parse the response
      return this.parseInsightResponse(result.text, specificQuery);
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
    return `You are an expert research analyst. Analyze the following context snippets related to the sub-query "${specificQuery}" (part of a larger research on "${originalQuery}").

Context Snippets:
${context}

Based ONLY on the provided context snippets:

1. Answer the sub-query: "${specificQuery}".
2. Extract key learnings. For each learning, explicitly cite the source URL or Title mentioned in the context snippet it came from (e.g., "Learning from [Source Title/URL]: ...").
3. Identify any connections, contradictions, or gaps between the different source snippets.
4. Generate 1-2 specific follow-up questions based on gaps or interesting points in THIS context.

Return your response in this JSON format:
{
  "answer": "Your synthesized answer to the sub-query...",
  "learnings": [
    { "text": "Insightful learning 1...", "source": "[Source Title/URL from context]" },
    { "text": "Insightful learning 2...", "source": "[Source Title/URL from context]" }
  ],
  "analysis": "Brief analysis of connections/contradictions/gaps...",
  "followUpQuestions": ["Specific question 1?", "Specific question 2?"]
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
          });
        } else {
          // No clear source, use generic source
          learnings.push({
            text: item.trim(),
            source: "Research Context",
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
}
