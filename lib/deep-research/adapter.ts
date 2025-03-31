import { DataStreamWriter, tool } from "ai";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { ModelsByCapability, myProvider } from "../ai/models";

import { ResearchOrchestrator, ResearchResult } from "./research-orchestrator";
import { WorkflowConfig } from "./types";

/**
 * Props for creating a deep research tool
 */
interface DeepResearchToolProps {
  dataStream: DataStreamWriter;
  app: FirecrawlApp;
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
export const deepResearch = ({
  dataStream,
  app,
  models,
}: DeepResearchToolProps) =>
  tool({
    description: "Search the web for information",
    parameters: z.object({
      topic: z.string().describe("The topic or question to research"),
      maxDepth: z.number().optional().describe("The maximum depth of research"),
    }),
    execute: async ({
      topic,
      maxDepth = 7,
    }): Promise<DeepResearchToolResult> => {
      try {
        // Create configuration
        const config: WorkflowConfig = {
          maxDepth,
          maxTokens: 25000,
          timeout: 270000, // 4.5 minutes
          concurrencyLimit: 3,
        };

        // Create research orchestrator
        const orchestrator = new ResearchOrchestrator(
          app,
          myProvider,
          models,
          dataStream
        );

        // Run the research
        const result = await orchestrator.runDeepResearchWorkflow(
          topic,
          config
        );

        // Prepare the data for the tool result
        // Use the finalReport as the main content
        const reportContent = result.finalReport;

        // Estimate steps based on metrics
        const completedSteps =
          Math.max(result.metrics.iterationsCompleted, 1) * 5; // Ensure at least 5 steps if iterations = 0
        const totalSteps = Math.max(maxDepth * 5, completedSteps); // Ensure total is at least completed

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
