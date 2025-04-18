import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { ModelsByCapability, myProvider } from "../ai/models";

import { ResearchOrchestrator, ResearchResult } from "./research-orchestrator";
import { WorkflowConfig, ResearchOptions, ResearchLogEntry } from "./types";

// Example input updated to include objectives, deliverables, and extract_top_k_chunks:
// {
//   "topic": "Quantization of Large Language Models",
//   "objectives": [
//     "Summarise INT8, INT4, and emerging NF4/FP8 techniques",
//     "Provide quantitative benchmarks (accuracy, latency, memory) for at least 3 open LLMs (e.g., Llama‑2‑7B, GPT‑J, BLOOM)",
//     "Discuss trade‑offs and mitigation strategies"
//   ],
//   "deliverables": [
//     "≤200‑word executive summary",
//     "One comparative table of benchmark metrics",
//     "Proper APA‑style references (peer‑reviewed preferred)"
//   ],
//   "extract_top_k_chunks": 10
// }

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
    logs?: ResearchLogEntry[];
  };
}

const MAX_RESEARCH_DURATION = process.env.NEXT_PUBLIC_MAX_RESEARCH_DURATION
  ? parseInt(process.env.NEXT_PUBLIC_MAX_RESEARCH_DURATION)
  : 10;

/**
 * Adapter to convert the new modular deep research system into a tool
 * compatible with the existing system.
 */
export const deepResearch = ({ dataStream, models }: DeepResearchToolProps) =>
  tool({
    description: "Conduct multi-step, citation-aware deep research on a topic",
    parameters: z.object({
      topic: z.string().describe("The topic or question to research"),
      extract_top_k_chunks: z
        .number()
        .int()
        .positive()
        .default(5)
        .describe("Number of relevant chunks to extract per source"),
    }),
    execute: async ({
      topic,
      extract_top_k_chunks = 5,
    }): Promise<DeepResearchToolResult> => {
      const maxDepth = 7;
      let orchestrator: ResearchOrchestrator | null = null;
      try {
        const minutes = MAX_RESEARCH_DURATION;
        const timeout = minutes * 60 * 1000;

        const config: WorkflowConfig = {
          maxDepth,
          maxTokens: 25000,
          timeout,
          concurrencyLimit: 3,
        };

        const options: ResearchOptions = {
          extract_top_k_chunks,
        };

        orchestrator = new ResearchOrchestrator(
          myProvider,
          models,
          dataStream,
          options
        );

        const result = await orchestrator.runDeepResearchWorkflow(
          topic,
          config
        );

        const reportContent = result.finalReport;

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
            logs: orchestrator.getLogs(),
          },
        };
      } catch (error: any) {
        console.error("Deep research tool error:", error);
        const logs = orchestrator ? orchestrator.getLogs() : [];
        return {
          success: false,
          error: error.message || "Unknown error in deep research",
          data: {
            completedSteps: 0,
            totalSteps: maxDepth * 5,
            logs: logs,
          },
        };
      }
    },
  });
