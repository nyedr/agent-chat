import { DataStreamWriter, generateText, tool } from "ai";
import { z } from "zod";
import { myProvider } from "../models";
import FirecrawlApp from "@mendable/firecrawl-js";

interface DeepResearchToolProps {
  dataStream: DataStreamWriter;
  app: FirecrawlApp;
  reasoningModelId: string;
}

interface ResearchFinding {
  text: string;
  source: string;
}

interface DeepResearchToolResult {
  success: boolean;
  error?: string;
  data: {
    findings?: ResearchFinding[];
    analysis?: string;
    completedSteps: number;
    totalSteps: number;
  };
}

export const deepResearch = ({
  dataStream,
  app,
  reasoningModelId,
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
      const startTime = Date.now();
      const timeLimit = 4.5 * 60 * 1000; // 4 minutes 30 seconds in milliseconds

      const researchState = {
        findings: [] as Array<{ text: string; source: string }>,
        summaries: [] as Array<string>,
        nextSearchTopic: "",
        urlToSearch: "",
        currentDepth: 0,
        failedAttempts: 0,
        maxFailedAttempts: 3,
        completedSteps: 0,
        totalExpectedSteps: maxDepth * 5,
      };

      // Initialize progress tracking
      dataStream.writeData({
        type: "progress-init",
        content: {
          maxDepth,
          totalSteps: researchState.totalExpectedSteps,
        },
      });

      const addSource = (source: {
        url: string;
        title: string;
        description: string;
      }) => {
        dataStream.writeData({
          type: "source-delta",
          content: source,
        });
      };

      const addActivity = (activity: {
        type:
          | "search"
          | "extract"
          | "analyze"
          | "reasoning"
          | "synthesis"
          | "thought";
        status: "pending" | "complete" | "error";
        message: string;
        timestamp: string;
        depth: number;
      }) => {
        if (activity.status === "complete") {
          researchState.completedSteps++;
        }

        dataStream.writeData({
          type: "activity-delta",
          content: {
            ...activity,
            depth: researchState.currentDepth,
            completedSteps: researchState.completedSteps,
            totalSteps: researchState.totalExpectedSteps,
          },
        });
      };

      const analyzeAndPlan = async (
        findings: Array<{ text: string; source: string }>
      ) => {
        try {
          const timeElapsed = Date.now() - startTime;
          const timeRemaining = timeLimit - timeElapsed;
          const timeRemainingMinutes =
            Math.round((timeRemaining / 1000 / 60) * 10) / 10;

          // Reasoning model
          const result = await generateText({
            model: myProvider.chatModel(reasoningModelId),
            prompt: `You are a research agent analyzing findings about: ${topic}
                  You have ${timeRemainingMinutes} minutes remaining to complete the research but you don't need to use all of it.
                  Current findings: ${findings
                    .map((f) => `[From ${f.source}]: ${f.text}`)
                    .join("\n")}
                  What has been learned? What gaps remain? What specific aspects should be investigated next if any?
                  If you need to search for more information, include a nextSearchTopic.
                  If you need to search for more information in a specific URL, include a urlToSearch.
                  Important: If less than 1 minute remains, set shouldContinue to false to allow time for final synthesis.
                  If I have enough information, set shouldContinue to false.
                  
                  Respond in this exact JSON format:
                  {
                    "analysis": {
                      "summary": "summary of findings",
                      "gaps": ["gap1", "gap2"],
                      "nextSteps": ["step1", "step2"],
                      "shouldContinue": true/false,
                      "nextSearchTopic": "optional topic",
                      "urlToSearch": "optional url"
                    }
                  }`,
          });

          try {
            const parsed = JSON.parse(result.text);
            return parsed.analysis;
          } catch (error) {
            console.error("Failed to parse JSON response:", error);
            return null;
          }
        } catch (error) {
          console.error("Analysis error:", error);
          return null;
        }
      };

      const extractFromUrls = async (urls: string[]) => {
        const extractPromises = urls.map(async (url) => {
          try {
            addActivity({
              type: "extract",
              status: "pending",
              message: `Analyzing ${new URL(url).hostname}`,
              timestamp: new Date().toISOString(),
              depth: researchState.currentDepth,
            });

            const result = await app.extract([url], {
              prompt: `Extract key information about ${topic}. Focus on facts, data, and expert opinions. Analysis should be full of details and very comprehensive.`,
            });

            if (result.success) {
              addActivity({
                type: "extract",
                status: "complete",
                message: `Extracted from ${new URL(url).hostname}`,
                timestamp: new Date().toISOString(),
                depth: researchState.currentDepth,
              });

              if (Array.isArray(result.data)) {
                return result.data.map((item) => ({
                  text: item.data,
                  source: url,
                }));
              }
              return [{ text: result.data, source: url }];
            }
            return [];
          } catch {
            // console.warn(`Extraction failed for ${url}:`);
            return [];
          }
        });

        const results = await Promise.all(extractPromises);
        return results.flat();
      };

      try {
        while (researchState.currentDepth < maxDepth) {
          const timeElapsed = Date.now() - startTime;
          if (timeElapsed >= timeLimit) {
            break;
          }

          researchState.currentDepth++;

          dataStream.writeData({
            type: "depth-delta",
            content: {
              current: researchState.currentDepth,
              max: maxDepth,
              completedSteps: researchState.completedSteps,
              totalSteps: researchState.totalExpectedSteps,
            },
          });

          // Search phase
          addActivity({
            type: "search",
            status: "pending",
            message: `Searching for "${topic}"`,
            timestamp: new Date().toISOString(),
            depth: researchState.currentDepth,
          });

          let searchTopic = researchState.nextSearchTopic || topic;
          const searchResult = await app.search(searchTopic);

          if (!searchResult.success) {
            addActivity({
              type: "search",
              status: "error",
              message: `Search failed for "${searchTopic}"`,
              timestamp: new Date().toISOString(),
              depth: researchState.currentDepth,
            });

            researchState.failedAttempts++;
            if (
              researchState.failedAttempts >= researchState.maxFailedAttempts
            ) {
              break;
            }
            continue;
          }

          addActivity({
            type: "search",
            status: "complete",
            message: `Found ${searchResult.data.length} relevant results`,
            timestamp: new Date().toISOString(),
            depth: researchState.currentDepth,
          });

          // Add sources from search results
          searchResult.data.forEach((result: any) => {
            addSource({
              url: result.url,
              title: result.title,
              description: result.description,
            });
          });

          // Extract phase
          const topUrls = searchResult.data
            .slice(0, 3)
            .map((result: any) => result.url);

          const newFindings = await extractFromUrls([
            researchState.urlToSearch,
            ...topUrls,
          ]);
          researchState.findings.push(...newFindings);

          // Analysis phase
          addActivity({
            type: "analyze",
            status: "pending",
            message: "Analyzing findings",
            timestamp: new Date().toISOString(),
            depth: researchState.currentDepth,
          });

          const analysis = await analyzeAndPlan(researchState.findings);
          researchState.nextSearchTopic = analysis?.nextSearchTopic || "";
          researchState.urlToSearch = analysis?.urlToSearch || "";
          researchState.summaries.push(analysis?.summary || "");

          console.log(analysis);
          if (!analysis) {
            addActivity({
              type: "analyze",
              status: "error",
              message: "Failed to analyze findings",
              timestamp: new Date().toISOString(),
              depth: researchState.currentDepth,
            });

            researchState.failedAttempts++;
            if (
              researchState.failedAttempts >= researchState.maxFailedAttempts
            ) {
              break;
            }
            continue;
          }

          addActivity({
            type: "analyze",
            status: "complete",
            message: analysis.summary,
            timestamp: new Date().toISOString(),
            depth: researchState.currentDepth,
          });

          if (!analysis.shouldContinue || analysis.gaps.length === 0) {
            break;
          }

          topic = analysis.gaps.shift() || topic;
        }

        // Final synthesis
        addActivity({
          type: "synthesis",
          status: "pending",
          message: "Preparing final analysis",
          timestamp: new Date().toISOString(),
          depth: researchState.currentDepth,
        });

        const finalAnalysis = await generateText({
          model: myProvider.chatModel(reasoningModelId),
          maxTokens: 16000,
          prompt: `Create a comprehensive long analysis of ${topic} based on these findings:
                ${researchState.findings
                  .map((f) => `[From ${f.source}]: ${f.text}`)
                  .join("\n")}
                ${researchState.summaries
                  .map((s) => `[Summary]: ${s}`)
                  .join("\n")}
                Provide all the thoughts processes including findings details,key insights, conclusions, and any remaining uncertainties. Include citations to sources where appropriate. This analysis should be very comprehensive and full of details. It is expected to be very long, detailed and comprehensive.`,
        });

        addActivity({
          type: "synthesis",
          status: "complete",
          message: "Research completed",
          timestamp: new Date().toISOString(),
          depth: researchState.currentDepth,
        });

        dataStream.writeData({
          type: "finish",
          content: finalAnalysis.text,
        });

        return {
          success: true,
          data: {
            findings: researchState.findings,
            analysis: finalAnalysis.text,
            completedSteps: researchState.completedSteps,
            totalSteps: researchState.totalExpectedSteps,
          },
        };
      } catch (error: any) {
        console.error("Deep research error:", error);

        addActivity({
          type: "thought",
          status: "error",
          message: `Research failed: ${error.message}`,
          timestamp: new Date().toISOString(),
          depth: researchState.currentDepth,
        });

        return {
          success: false,
          error: error.message,
          data: {
            findings: researchState.findings,
            completedSteps: researchState.completedSteps,
            totalSteps: researchState.totalExpectedSteps,
          },
        };
      }
    },
  });
