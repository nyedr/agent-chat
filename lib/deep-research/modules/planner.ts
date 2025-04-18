import { z } from "zod";
import { generateObject } from "ai";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";

import { SearchModule } from "./search";
import { ModelsByCapability } from "../../ai/models";
import type { ResearchLogEntry, ReportPlan, ResearchState } from "../types";
import type { ProgressEventType } from "./progress-updater";

const ReportPlanSectionSchema = z.object({
  title: z.string().min(1, "Section title cannot be empty"),
  key_question: z.string().min(1, "Key question cannot be empty"),
});

export const ReportPlanSchema = z.object({
  report_title: z.string().min(1, "Report title cannot be empty"),
  report_outline: z
    .array(ReportPlanSectionSchema)
    .min(1, "Report outline must have at least one section"),
});

interface PlannerDependencies {
  llmProvider: OpenAICompatibleProvider<string, string, string>;
  models: ModelsByCapability;
  searchModule: SearchModule;
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
 * Plans the initial research by generating a structured report plan.
 *
 * @param query - Main research query
 * @param state - Current research state (passed for logging/progress updates)
 * @param dependencies - Required modules and functions
 * @param objectives - Optional list of specific goals for the research.
 * @param deliverables - Optional list of expected output formats.
 * @returns Promise with the generated ReportPlan
 */
export async function planInitialResearch(
  query: string,
  state: any,
  dependencies: PlannerDependencies,
  objectives: string[] = [],
  deliverables: string[] = []
): Promise<ReportPlan> {
  const { llmProvider, models, searchModule, addLogEntry, updateProgress } =
    dependencies;

  addLogEntry(
    "plan",
    "pending",
    "Planning research strategy...",
    state.currentDepth
  );
  updateProgress(state, "activity-delta", "Planning research strategy...");

  let prelimContext = "";
  try {
    addLogEntry(
      "search",
      "pending",
      "Gathering preliminary context for planning...",
      state.currentDepth
    );
    const preliminarySearchResults = await searchModule.searchWeb(query);
    if (preliminarySearchResults.length > 0) {
      addLogEntry(
        "search",
        "complete",
        `Gathered preliminary context (${preliminarySearchResults.length} results).`,
        state.currentDepth
      );
      updateProgress(
        state,
        "activity-delta",
        `Gathered preliminary context for planning.`
      );
    } else {
      addLogEntry(
        "search",
        "warning",
        `No preliminary context found.`,
        state.currentDepth
      );
    }
    const topResults = preliminarySearchResults.slice(0, 3);
    if (topResults.length > 0) {
      prelimContext =
        "Based on initial search results:\n" +
        topResults
          .map((r) => `- ${r.title || r.url}: ${r.content || "No snippet"}`)
          .join("\n");
    }
  } catch (searchError) {
    console.warn("Preliminary search failed during planning:", searchError);
    addLogEntry(
      "search",
      "error",
      `Preliminary search failed: ${(searchError as Error).message}`,
      state.currentDepth
    );
    updateProgress(state, "warning", `Preliminary search failed.`);
  }

  const objectivesSection =
    objectives.length > 0
      ? `\nUser Objectives:\n${objectives.map((o) => `- ${o}`).join("\n")}`
      : "";
  const deliverablesSection =
    deliverables.length > 0
      ? `\nUser Deliverables:\n${deliverables.map((d) => `- ${d}`).join("\n")}`
      : "";

  const planningPrompt = `You are a research manager planning a report for the query: "${query}".

${objectivesSection ? `**Objectives to satisfy**:${objectivesSection}\n` : ""}
${
  deliverablesSection
    ? `**Expected deliverables**:${deliverablesSection}\n`
    : ""
}
${prelimContext ? `\n**Preliminary Context**:\n${prelimContext}\n` : ""}
Your task is to create a structured report plan including:
1. A concise, relevant title for the final report.
2. A logical outline of 3-5 main sections. Ensure the outline is structured to fully address **every objective listed above**.
3. For EACH section, define a specific key question it should answer.

Return ONLY a JSON object matching this schema:
${JSON.stringify(ReportPlanSchema.shape)}
`;

  try {
    addLogEntry(
      "reasoning",
      "pending",
      "Generating report plan...",
      state.currentDepth
    );
    const { object: reportPlan } = await generateObject({
      model: llmProvider.chatModel(models.reasoning),
      schema: ReportPlanSchema,
      prompt: planningPrompt,
    });

    addLogEntry(
      "plan",
      "complete",
      `Planned ${reportPlan.report_outline.length} sections for report: "${reportPlan.report_title}"`,
      state.currentDepth
    );
    updateProgress(
      state,
      "activity-delta",
      `Planned ${reportPlan.report_outline.length} sections for report: "${reportPlan.report_title}"`
    );

    // Note: Incrementing completedSteps should happen in the orchestrator after this resolves
    return reportPlan;
  } catch (error) {
    console.error("Error during structured research planning:", error);
    addLogEntry(
      "plan",
      "error",
      `Failed to create structured research plan: ${(error as Error).message}`,
      state.currentDepth
    );
    updateProgress(
      state,
      "error",
      "Failed to create structured research plan."
    );

    // Fallback: Create a basic plan with the original query
    const fallbackPlan: ReportPlan = {
      report_title: query,
      report_outline: [{ title: "Main Research", key_question: query }],
    };
    addLogEntry(
      "plan",
      "complete",
      `Using fallback plan due to error.`,
      state.currentDepth
    );
    return fallbackPlan;
  }
}
