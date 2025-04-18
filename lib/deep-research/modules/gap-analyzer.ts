import { z } from "zod";
import { generateObject, generateText } from "ai";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";

import { ModelsByCapability } from "../../ai/models";
import type { Learning } from "./insight-generator";
import type {
  ResearchLogEntry,
  GapAnalysisResult,
  ResearchState,
  Gap,
} from "../types";
import type { ProgressEventType } from "./progress-updater";
import { QUALITY_DOMAINS } from "../utils";

const GapSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe("Specific description of the knowledge gap."),
  severity: z
    .number()
    .min(1)
    .max(3)
    .describe(
      "Severity of the gap (1=Low, 2=Medium, 3=High/Critical). High for fundamental missing info."
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Confidence (0-1) that targeted search can resolve this specific gap."
    ),
});

const GapAnalysisResultSchema = z.object({
  is_complete: z
    .boolean()
    .describe(
      "Is the key question sufficiently answered by the provided learnings?"
    ),
  remaining_gaps: z
    .array(GapSchema)
    .describe(
      "List of structured knowledge gaps, if not complete. Empty array if complete."
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
  updateProgress: (
    state: ResearchState,
    type: ProgressEventType,
    message: string
  ) => void;
}

/**
 * Analyzes knowledge gaps based on latest learnings for a key question.
 */
export async function analyzeKnowledgeGaps(
  keyQuestion: string,
  latestLearnings: Learning[],
  state: ResearchState,
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
      remaining_gaps: [
        {
          text: `Re-evaluate findings for "${keyQuestion}"`,
          severity: 3 as 1 | 2 | 3,
          confidence: 0.5,
        } as Gap,
      ],
    };
  }

  const learningsContext = latestLearnings
    .map((l, i) => `[L${i + 1}] ${l.text} (Source: ${l.source || "N/A"})`)
    .join("\n");

  const gapPrompt = `You are a critical research evaluator tasked with identifying knowledge gaps.

Original Key Question: "${keyQuestion}"

Latest Learnings Gathered:
\`\`\`
${learningsContext}
\`\`\`

Instructions:
1. Evaluate if the Key Question is **comprehensively** answered based *only* on the provided Learnings. Consider if critical details (e.g., formulas, algorithms, benchmarks, specific examples) are present, if relevant.
2. If the question is NOT comprehensively answered, identify the **most important 1-3 remaining knowledge gaps**.
3. For EACH identified gap, provide:
   - 'text': A specific, actionable description of the missing information.
   - 'severity': An integer (1, 2, or 3) indicating how critical the gap is to answering the Key Question (1: Low - minor detail, 2: Medium - helpful context, 3: High - fundamental info).
   - 'confidence': A float (0.0 to 1.0) estimating the likelihood that a *targeted web search* can successfully find this specific missing information.

Return ONLY a JSON object matching this structure:
\`\`\`json
{
  "is_complete": boolean, // True if Key Question is comprehensively answered, false otherwise.
  "remaining_gaps": [
    {
      "text": "Specific knowledge gap description...",
      "severity": 1 | 2 | 3,
      "confidence": number (0.0 - 1.0)
    }
    // ... up to 2 more gap objects if needed ...
  ]
}
\`\`\`
If 'is_complete' is true, 'remaining_gaps' MUST be an empty array.
If 'is_complete' is false, 'remaining_gaps' MUST contain at least one gap object.
`;

  try {
    addLogEntry(
      "reasoning",
      "pending",
      `Performing gap analysis via LLM...`,
      state.currentDepth
    );
    const { object: gapResult } = (await generateObject({
      model: llmProvider.chatModel(models.reasoning),
      schema: GapAnalysisResultSchema,
      prompt: gapPrompt,
    })) as { object: GapAnalysisResult };
    addLogEntry(
      "analyze",
      "complete",
      `Gap analysis complete. Question complete: ${gapResult.is_complete}. Gaps identified: ${gapResult.remaining_gaps.length}`,
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
    // Define the fallback gap explicitly with the correct type
    const fallbackGap: Gap = {
      text: `Re-evaluate findings for "${keyQuestion}"`,
      severity: 3, // TypeScript should infer this correctly now within the typed variable
      confidence: 0.5,
    };
    return {
      is_complete: false,
      remaining_gaps: [
        fallbackGap, // Use the typed variable
      ],
    };
  }
}

/**
 * Generates targeted search queries based on an identified knowledge gap.
 */
export async function generateTargetedQueries(
  gap: string,
  originalQuery: string,
  state: ResearchState,
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

  const domainHintText = QUALITY_DOMAINS.map((d) => `"site:${d}"`).join(", ");

  const queryGenPrompt = `
  You are crafting next-step web-search queries.
  
  • Gap: "${gap}"
  • Original topic: "${originalQuery}"
  
  Return 1 or 2 concise queries **in JSON array form**.
  
  Guidelines:
    - If you suspect an authoritative domain will help, optionally add a site filter (${domainHintText})
    - Otherwise don't add a site filter.
    - Query should stay usable even if the domain has no results.
    - Prefer adding a metric (accuracy, R², latency, etc.) or a filetype:pdf hint when it aids precision.
    - Put variables in quotes to turn off stemming: "scale factor", "zero-point".
    - Prefer filetype:pdf for formulas, table:, csv:, or "benchmark" for numbers.
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
