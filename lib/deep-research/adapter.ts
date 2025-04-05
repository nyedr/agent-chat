import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { ModelsByCapability, myProvider } from "../ai/models";

import { ResearchOrchestrator, ResearchResult } from "./research-orchestrator";
import { WorkflowConfig, ResearchOptions } from "./types";

/**
 * Props for creating a deep research tool
 */
interface DeepResearchToolProps {
  dataStream: DataStreamWriter;
  models: ModelsByCapability;
}

/**
 * Result returned from the deep research tool
 */
export interface DeepResearchToolResult {
  success: boolean;
  error?: string;
  data: {
    reportContent?: string;
    sources?: Record<string, string>;
    metrics?: ResearchResult["metrics"];
    completedSteps: number;
    totalSteps: number;
  };
}

/**
 * Adapter to convert the new modular deep research system into a tool
 * compatible with the existing system.
 */
export const deepResearch = ({ dataStream, models }: DeepResearchToolProps) =>
  tool({
    description: "Search the web for information",
    parameters: z.object({
      topic: z.string().describe("The topic or question to research"),
      maxDepth: z.number().optional().describe("The maximum depth of research"),
      extract_top_k_chunks: z
        .number()
        .optional()
        .default(5)
        .describe("Number of relevant chunks to extract per source"),
    }),
    execute: async ({
      topic,
      maxDepth = 7,
      extract_top_k_chunks = 5,
    }): Promise<DeepResearchToolResult> => {
      try {
        // Create configuration
        const config: WorkflowConfig = {
          maxDepth,
          maxTokens: 25000,
          timeout: 270000, // 4.5 minutes
          concurrencyLimit: 3,
        };

        // Define ResearchOptions
        const options: ResearchOptions = {
          extract_top_k_chunks,
        };

        // Create research orchestrator with options
        const orchestrator = new ResearchOrchestrator(
          myProvider,
          models,
          dataStream,
          options
        );

        // Run the research
        const result = await orchestrator.runDeepResearchWorkflow(
          topic,
          config
        );

        // Prepare the data for the tool result
        // Use the finalReport as the main content
        const reportContent = result.finalReport;

        // Use the actual step counts returned from the orchestrator
        const completedSteps = result.completedSteps;
        const totalSteps = result.totalSteps;

        return {
          success: true,
          error: undefined,
          data: {
            reportContent,
            sources: result.sources,
            metrics: result.metrics,
            completedSteps,
            totalSteps,
          },
        };
      } catch (error: any) {
        console.error("Deep research tool error:", error);
        return {
          success: false,
          error: error.message || "Unknown error in deep research",
          data: {
            completedSteps: 0,
            totalSteps: maxDepth * 5,
          },
        };
      }
    },
  });
