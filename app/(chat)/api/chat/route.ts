import {
  type Message,
  createDataStreamResponse,
  generateText,
  smoothStream,
  streamText,
} from "ai";
import { z } from "zod";
import { myProvider } from "@/lib/ai/models";

import { systemPrompt } from "@/lib/ai/prompts";
import {
  addChatMessage,
  createNewChat,
  deleteChatById,
  getAllChats,
  getChatById,
  updateChat,
} from "@/app/(chat)/actions";
import {
  generateUUID,
  getMessageContent,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from "@/lib/utils";

import FirecrawlApp from "@mendable/firecrawl-js";

type AllowedTools = "deepResearch" | "search" | "extract" | "scrape";

const deepResearchTools: AllowedTools[] = [
  "search",
  "extract",
  "scrape",
  "deepResearch",
];

const allTools: AllowedTools[] = [...deepResearchTools];

const app = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY || "",
});

export async function POST(request: Request) {
  const {
    id,
    messages,
    modelId,
    reasoningModelId,
    experimental_deepResearch = false,
  }: {
    id: string;
    messages: Array<Message>;
    modelId: string;
    reasoningModelId: string;
    experimental_deepResearch?: boolean;
  } = await request.json();

  const userMessage = getMostRecentUserMessage(messages);

  if (!userMessage) {
    return new Response("No user message found", { status: 400 });
  }

  console.log("userMessage:", userMessage);

  const chat = await getChatById({ id });

  if (!chat.data || chat.error !== null || !chat.data.chat) {
    console.log("Chat not found, creating new chat");
    // const title = await generateTitleFromUserMessage({ message: userMessage });

    const title =
      typeof userMessage.content === "string"
        ? userMessage.content
        : "New Chat";

    const newChat = await createNewChat({
      title,
      providedId: id,
    });

    if (!newChat.success) {
      return new Response("Failed to create new chat", { status: 500 });
    }
  }

  const validMessages = messages
    .with(-1, userMessage)
    .map(({ parts, ...rest }: any) => {
      return {
        ...rest,
        content: getMessageContent(rest as Message),
      };
    }) satisfies Message[];

  console.log("validMessages:", validMessages);

  await addChatMessage({
    chatId: id,
    message: userMessage,
  });

  return createDataStreamResponse({
    execute: (dataStream) => {
      dataStream.writeData({
        type: "user-message-id",
        content: userMessage.id,
      });

      const result = streamText({
        model: myProvider.chatModel(modelId),
        system: systemPrompt({
          tools: experimental_deepResearch ? deepResearchTools : allTools,
        }),
        messages: validMessages,
        maxSteps: 10,
        experimental_transform: smoothStream() as any,
        experimental_generateMessageId: generateUUID,
        // toolChoice: experimental_deepResearch
        //   ? {
        //       toolName: "deepResearch",
        //       type: "tool",
        //     }
        //   : undefined,
        experimental_activeTools: experimental_deepResearch
          ? deepResearchTools
          : allTools,
        tools: {
          search: {
            description:
              "Search for web pages. Normally you should call the extract tool after this one to get a spceific data point if search doesn't the exact data you need.",
            parameters: z.object({
              query: z
                .string()
                .describe("Search query to find relevant web pages"),
              maxResults: z
                .number()
                .optional()
                .describe("Maximum number of results to return (default 10)"),
            }),
            execute: async ({ query, maxResults = 5 }) => {
              try {
                const searchResult = await app.search(query);

                if (!searchResult.success) {
                  return {
                    error: `Search failed: ${searchResult.error}`,
                    success: false,
                  };
                }

                // Add favicon URLs to search results
                const resultsWithFavicons = searchResult.data.map(
                  (result: any) => {
                    const url = new URL(result.url);
                    const favicon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
                    return {
                      ...result,
                      favicon,
                    };
                  }
                );

                searchResult.data = resultsWithFavicons;

                return {
                  data: searchResult.data,
                  success: true,
                };
              } catch (error: any) {
                return {
                  error: `Search failed: ${error.message}`,
                  success: false,
                };
              }
            },
          },
          extract: {
            description:
              "Extract structured data from web pages. Use this to get whatever data you need from a URL. Any time someone needs to gather data from something, use this tool.",
            parameters: z.object({
              urls: z.array(z.string()).describe(
                "Array of URLs to extract data from"
                // , include a /* at the end of each URL if you think you need to search for other pages insides that URL to extract the full data from',
              ),
              prompt: z
                .string()
                .describe("Description of what data to extract"),
            }),
            execute: async ({ urls, prompt }) => {
              try {
                const scrapeResult = await app.extract(urls, {
                  prompt,
                });

                if (!scrapeResult.success) {
                  return {
                    error: `Failed to extract data: ${scrapeResult.error}`,
                    success: false,
                  };
                }

                return {
                  data: scrapeResult.data,
                  success: true,
                };
              } catch (error: any) {
                console.error("Extraction error:", error);
                console.error(error.message);
                console.error(error.error);
                return {
                  error: `Extraction failed: ${error.message}`,
                  success: false,
                };
              }
            },
          },
          scrape: {
            description:
              "Scrape web pages. Use this to get from a page when you have the url.",
            parameters: z.object({
              url: z.string().describe("URL to scrape"),
            }),
            execute: async ({ url }: { url: string }) => {
              try {
                const scrapeResult = await app.scrapeUrl(url);

                if (!scrapeResult.success) {
                  return {
                    error: `Failed to extract data: ${scrapeResult.error}`,
                    success: false,
                  };
                }

                return {
                  data:
                    scrapeResult.markdown ??
                    "Could get the page content, try using search or extract",
                  success: true,
                };
              } catch (error: any) {
                console.error("Extraction error:", error);
                console.error(error.message);
                console.error(error.error);
                return {
                  error: `Extraction failed: ${error.message}`,
                  success: false,
                };
              }
            },
          },
          deepResearch: {
            description:
              "Perform deep research on a topic using an AI agent that coordinates search, extract, and analysis tools with reasoning steps.",
            parameters: z.object({
              topic: z.string().describe("The topic or question to research"),
            }),
            execute: async ({ topic, maxDepth = 7 }) => {
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
                      researchState.failedAttempts >=
                      researchState.maxFailedAttempts
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
                  researchState.nextSearchTopic =
                    analysis?.nextSearchTopic || "";
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
                      researchState.failedAttempts >=
                      researchState.maxFailedAttempts
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
          },
        },
        onFinish: async ({ response }) => {
          try {
            const sanitizedResponseMessage = sanitizeResponseMessages(
              response.messages
            ) as Message;

            console.log("sanitizedResponseMessage:", sanitizedResponseMessage);

            const assistantMessageId = response.messages
              .filter((message) => message.role === "assistant")
              .at(-1)?.id;

            if (!assistantMessageId) {
              throw new Error("No assistant message found!");
            }

            if (sanitizedResponseMessage.role === "assistant") {
              dataStream.writeMessageAnnotation({
                messageIdFromServer: assistantMessageId,
              });
            }

            const responseMessage: Message = {
              createdAt: new Date(),
              content: getMessageContent(sanitizedResponseMessage),
              role: sanitizedResponseMessage.role,
              parts: sanitizedResponseMessage.parts,
              id: assistantMessageId,
              experimental_attachments:
                sanitizedResponseMessage.experimental_attachments,
            };

            console.log("responseMessage:", responseMessage);

            await addChatMessage({
              chatId: id,
              message: responseMessage,
            });
          } catch (error) {
            console.error("Failed to save chat");
          }
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "No ID provided" }, { status: 400 });
  }

  try {
    await deleteChatById(id);
    return Response.json({ success: true, message: "Chat deleted" });
  } catch (error) {
    console.error("Error deleting chat:", error);
    return Response.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const chats = await getAllChats();
    return Response.json({
      data: chats,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Failed to get chats", error);
    return Response.json({
      data: [],
      error: "An error occurred while processing your request",
      status: 500,
    });
  }
}

const chatUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  folder_id: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("id");

    if (!chatId) {
      return Response.json({
        data: null,
        error: "Chat ID is required",
        status: 400,
      });
    }

    const result = chatUpdateSchema.safeParse(body);
    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    await updateChat({
      id: chatId,
      ...result.data,
    });

    const chat = await getChatById({ id: chatId });
    return Response.json({
      data: chat.data,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in PUT /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to update chat",
      status: 500,
    });
  }
}
