import { z } from "zod";
import { generateObject, generateText } from "ai";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";

import { ModelsByCapability } from "../../ai/models";
import type { Learning } from "./insight-generator";
import type { ResearchLogEntry, GapAnalysisResult } from "../types";

const GapAnalysisSchema = z.object({
  is_complete: z
    .boolean()
    .describe(
      "Is the key question sufficiently answered by the provided learnings?"
    ),
  remaining_gaps: z
    .array(z.string())
    .describe(
      "List of specific knowledge gaps remaining for the key question, if not complete."
    ),
});

interface GapAnalyzerDependencies {
  llmProvider: OpenAICompatibleProvider<string, string, string>;
  models: ModelsByCapability;
  addLogEntry: (
    type: ResearchLogEntry["type"],
    status: ResearchLogEntry["status"],
    message: string,
    depth?: number
  ) => void;
  updateProgress: (state: any, type: string, message: string) => void;
}

/**
 * Analyzes knowledge gaps based on latest learnings for a key question.
 */
export async function analyzeKnowledgeGaps(
  keyQuestion: string,
  latestLearnings: Learning[],
  state: any,
  dependencies: GapAnalyzerDependencies
): Promise<GapAnalysisResult> {
  const { addLogEntry, updateProgress, llmProvider, models } = dependencies;

  addLogEntry(
    "analyze",
    "pending",
    `Analyzing gaps for: ${keyQuestion.substring(0, 40)}...`,
    state.currentDepth
  );
  updateProgress(
    state,
    "activity-delta",
    `Analyzing gaps for: ${keyQuestion.substring(0, 40)}...`
  );

  if (latestLearnings.length === 0) {
    addLogEntry(
      "analyze",
      "warning",
      `No learnings to analyze for gap assessment of "${keyQuestion}".`,
      state.currentDepth
    );
    updateProgress(
      state,
      "warning",
      `No learnings to analyze for gap assessment.`
    );
    return {
      is_complete: false,
      remaining_gaps: ["Need initial information."],
    };
  }

  const learningsContext = latestLearnings
    .map((l, i) => `[L${i + 1}] ${l.text} (Source: ${l.source || "N/A"})`)
    .join("\n");

  const gapPrompt = `You are a critical research evaluator.

Original Key Question for this section: "${keyQuestion}"

Latest Learnings Gathered for this question:
\`\`\`
${learningsContext}
\`\`\`

Based _only_ on the latest learnings provided:
1. Is the Key Question now sufficiently and comprehensively answered? Consider if critical details like **mathematical formulas, specific algorithms, quantitative data, or implementation specifics** are present if relevant to the question.
2. If NOT sufficiently answered, list 1-3 specific, actionable knowledge gaps that still need to be addressed to fully answer the Key Question. Be precise about what kind of detail is missing (e.g., "Need mathematical derivation of X", "Lack quantitative examples of Y", "Specific algorithm for Z is unclear").

Return ONLY a JSON object matching this schema:
${JSON.stringify(GapAnalysisSchema.shape)}
`;

  try {
    addLogEntry(
      "reasoning",
      "pending",
      `Performing gap analysis via LLM...`,
      state.currentDepth
    );
    const { object: gapResult } = await generateObject({
      model: llmProvider.chatModel(models.reasoning),
      schema: GapAnalysisSchema,
      prompt: gapPrompt,
    });
    addLogEntry(
      "analyze",
      "complete",
      `Gap analysis complete. Question complete: ${
        gapResult.is_complete
      }. Gaps: ${gapResult.remaining_gaps.join(", ") || "None"}`,
      state.currentDepth
    );
    updateProgress(
      state,
      "activity-delta",
      `Gap analysis complete. Question complete: ${gapResult.is_complete}`
    );

    return gapResult;
  } catch (error) {
    console.error("Error during gap analysis:", error);
    addLogEntry(
      "analyze",
      "error",
      `Failed to analyze knowledge gaps: ${(error as Error).message}`,
      state.currentDepth
    );
    updateProgress(state, "error", "Failed to analyze knowledge gaps.");
    return {
      is_complete: false,
      remaining_gaps: [`Re-evaluate findings for "${keyQuestion}"`],
    };
  }
}

/**
 * Generates targeted search queries based on an identified knowledge gap.
 */
export async function generateTargetedQueries(
  gap: string,
  originalQuery: string,
  keyQuestion: string,
  state: any,
  dependencies: GapAnalyzerDependencies
): Promise<string[]> {
  const { addLogEntry, updateProgress, llmProvider, models } = dependencies;

  addLogEntry(
    "reasoning",
    "pending",
    `Generating targeted query for gap: ${gap.substring(0, 50)}...`,
    state.currentDepth
  );
  updateProgress(
    state,
    "activity-delta",
    `Generating targeted query for gap: ${gap.substring(0, 50)}...`
  );

  const queryGenPrompt = `Research Context: The overall goal is to research "${originalQuery}". We are currently focused on answering the sub-question "${keyQuestion}".

Knowledge Gap Identified: "${gap}"

Generate 1 or 2 highly specific, targeted search engine queries (3-7 words each) that directly address ONLY the identified knowledge gap.

Return ONLY a JSON array of strings. Example: ["specific query 1", "specific query 2"]
`;

  try {
    const result = await generateText({
      model: llmProvider.chatModel(models.reasoning),
      prompt: queryGenPrompt,
    });

    // Attempt to parse JSON robustly
    let queries: string[] = [];
    try {
      // Find the first valid JSON array in the potentially messy output
      const match = result.text.match(/(\[\s*[\s\S]*?\s*\])/s);
      if (match && match[0]) {
        queries = JSON.parse(match[0]);
      } else {
        // Fallback: Try parsing the whole trimmed text if no array found
        queries = JSON.parse(result.text.trim());
      }

      if (
        !Array.isArray(queries) ||
        !queries.every((q) => typeof q === "string")
      ) {
        throw new Error("Parsed result is not a valid JSON array of strings.");
      }
    } catch (parseError) {
      console.error(
        "Failed to parse targeted queries from LLM output:",
        result.text,
        parseError
      );
      throw new Error(
        "LLM did not return a valid JSON array of strings for targeted queries."
      );
    }

    queries = queries.slice(0, 2); // Limit to max 2 queries
    addLogEntry(
      "reasoning",
      "complete",
      `Generated targeted queries: ${queries.join(", ")}`,
      state.currentDepth
    );
    updateProgress(
      state,
      "activity-delta",
      `Generated targeted queries for gap`
    );

    return queries;
  } catch (error) {
    console.error("Error generating targeted queries:", error);
    addLogEntry(
      "reasoning",
      "error",
      `Failed to generate targeted queries: ${(error as Error).message}`,
      state.currentDepth
    );
    updateProgress(state, "error", "Failed to generate targeted queries");

    // Fallback: create a simple query from the gap itself
    const fallbackQuery = gap.split(" ").slice(0, 6).join(" ");
    return [fallbackQuery];
  }
}
