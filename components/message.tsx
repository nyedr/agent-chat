"use client";

import type { ChatRequestOptions, Message } from "ai";
import cx from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useMemo, useState, useEffect, useCallback } from "react";

import Markdown from "./markdown";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import equal from "fast-deep-equal";
import { cn, getMessageContent } from "@/lib/utils";
import { MessageEditor } from "./message-editor";
import { SearchResults } from "./search-results";
import { ExtractResults } from "./extract-results";
import { ScrapeResults } from "./scrape-results";
import { useDeepResearch } from "@/lib/deep-research-context";
import { Progress } from "./ui/progress";
import AnimatedGradientText from "./ui/gradient-text";
import { deleteSingleMessage } from "@/app/(chat)/actions";
import Image from "next/image";
import { DocumentToolCall, DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  setMessages,
  reload,
}: {
  chatId: string;
  message: Message;
  isLoading: boolean;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const { addActivity, addSource, initProgress, setDepth, updateProgress } =
    useDeepResearch();

  const deleteMessage = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();

      try {
        await deleteSingleMessage({
          id: chatId,
          messageId: message.id,
        });

        setMessages((currentMessages) => {
          return currentMessages?.filter((msg) => msg.id !== message.id) || [];
        });
      } catch (error) {
        console.error("Error deleting message:", error);
      }
    },
    [message.id, setMessages, chatId]
  );

  // Track sources from search and extract results
  const [searchSources, setSearchSources] = useState<
    Array<{
      title: string;
      url: string;
      description: string;
      source: string;
      relevance: number;
    }>
  >([]);

  useEffect(() => {
    if (message.parts) {
      const sources: Array<{
        title: string;
        url: string;
        description: string;
        source: string;
        relevance: number;
      }> = [];

      message.parts.forEach((part) => {
        try {
          if (
            part.type === "tool-invocation" &&
            part.toolInvocation.toolName === "search" &&
            part.toolInvocation.state === "result"
          ) {
            const searchResults = part.toolInvocation.result.data.map(
              (item: any, index: number) => ({
                title: item.title,
                url: item.url,
                description: item.description,
                source: new URL(item.url).hostname,
                relevance: 1 - index * 0.1, // Decrease relevance for each subsequent result
              })
            );
            sources.push(...searchResults);
          }
        } catch (error) {
          console.error("Error processing search results:", error);
        }
      });

      setSearchSources(sources);
      sources.forEach((source) => addSource(source));
    }
  }, [message.parts, addSource]);

  useEffect(() => {
    if (message.parts) {
      message.parts.forEach((part) => {
        try {
          if (
            part.type === "tool-invocation" &&
            part.toolInvocation.toolName === "deepResearch"
          ) {
            const toolInvocation = part.toolInvocation;

            // Handle progress initialization
            if (
              "delta" in toolInvocation &&
              toolInvocation.delta &&
              (toolInvocation.delta as any).type === "progress-init"
            ) {
              const { maxDepth, totalSteps } = (toolInvocation.delta as any)
                .content;
              initProgress(maxDepth, totalSteps);
            }

            // Handle depth updates
            if (
              "delta" in toolInvocation &&
              toolInvocation.delta &&
              (toolInvocation.delta as any).type === "depth-delta"
            ) {
              const { current, max } = (toolInvocation.delta as any).content;
              setDepth(current, max);
            }

            // Handle activity updates
            if (
              "delta" in toolInvocation &&
              toolInvocation.delta &&
              (toolInvocation.delta as any).type === "activity-delta"
            ) {
              const activity = (toolInvocation.delta as any).content;
              addActivity(activity);

              if (
                activity.completedSteps !== undefined &&
                activity.totalSteps !== undefined
              ) {
                updateProgress(activity.completedSteps, activity.totalSteps);
              }
            }

            // Handle source updates
            if (
              "delta" in toolInvocation &&
              toolInvocation.delta &&
              (toolInvocation.delta as any).type === "source-delta"
            ) {
              addSource((toolInvocation.delta as any).content);
            }

            // Handle final result
            if (
              toolInvocation.state === "result" &&
              toolInvocation.result?.success
            ) {
              const { completedSteps, totalSteps } = toolInvocation.result.data;
              if (completedSteps !== undefined && totalSteps !== undefined) {
                updateProgress(completedSteps, totalSteps);
              }
            }
          }
        } catch (error) {
          console.error("Error processing deep research update:", error);
        }
      });
    }
  }, [
    message.parts,
    addActivity,
    addSource,
    initProgress,
    setDepth,
    updateProgress,
  ]);

  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
            {
              "w-full": mode === "edit",
              "group-data-[role=user]/message:w-fit": mode !== "edit",
            }
          )}
        >
          {/* {message.role === "assistant" && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )} */}

          <div
            className={cn("group flex flex-col gap-2 w-full", {
              "items-end": message.role === "user",
              "items-start": message.role === "assistant",
            })}
          >
            {message.experimental_attachments && (
              <div className="flex flex-row justify-end gap-2">
                {message.experimental_attachments.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={attachment}
                  />
                ))}
              </div>
            )}

            {message.content && mode === "view" && (
              <div
                className={cn(
                  "markdown-message-container flex flex-col gap-4 max-w-[736px] w-full",
                  {
                    "rounded-3xl px-5 py-2.5 bg-muted text-primary-foreground w-fit align-end":
                      message.role === "user",
                    "flex flex-col gap-2 items-start prose prose-sm dark:prose-invert align-start":
                      message.role === "assistant" &&
                      (!message.parts || message.parts.length === 0),
                  }
                )}
              >
                {message.role === "user" && (
                  <Markdown
                    isUserMessage={message.role === "user"}
                    content={getMessageContent(message)}
                  />
                )}
              </div>
            )}

            {message.content && mode === "edit" && (
              <div className="flex flex-row gap-2 items-start">
                <MessageEditor
                  key={message.id}
                  message={message}
                  setMode={setMode}
                  setMessages={setMessages}
                  reload={reload}
                  chatId={chatId}
                />
              </div>
            )}

            {message.role !== "user" &&
              message.parts &&
              message.parts.length > 0 && (
                <div className="flex flex-col gap-2">
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <div
                          key={`text-${index}`}
                          className="markdown-message-container flex flex-col max-w-[736px] w-full gap-2 prose prose-sm dark:prose-invert"
                        >
                          <Markdown isUserMessage={false} content={part.text} />
                        </div>
                      );
                    } else if (part.type === "tool-invocation") {
                      const { toolInvocation } = part;
                      const { toolName, toolCallId, state, args } =
                        toolInvocation;

                      if (state === "result") {
                        const { result } = toolInvocation;

                        return (
                          <div key={`tool-${toolCallId}`}>
                            {toolName === "search" ? (
                              <SearchResults
                                results={result.data.map((item: any) => ({
                                  title: item.title,
                                  url: item.url,
                                  description: item.description,
                                  source: new URL(item.url).hostname,
                                  favicon: item.favicon,
                                }))}
                              />
                            ) : toolName === "extract" ? (
                              <ExtractResults
                                results={
                                  state === "result" && result.data
                                    ? Array.isArray(result.data)
                                      ? result.data.map((item: any) => ({
                                          url: item.url,
                                          data: item.data,
                                        }))
                                      : {
                                          url: args.urls[0],
                                          data: result.data,
                                        }
                                    : []
                                }
                                isLoading={false}
                              />
                            ) : toolName === "scrape" ? (
                              <ScrapeResults
                                url={args.url}
                                data={result.data}
                                isLoading={false}
                              />
                            ) : toolName === "deepResearch" ? (
                              <div className="text-sm text-muted-foreground">
                                {result.success
                                  ? "Research completed successfully."
                                  : `Research may have failed: ${result.error}`}
                              </div>
                            ) : toolName === "createDocument" ? (
                              <DocumentPreview
                                result={result}
                                isReadonly={false}
                              />
                            ) : toolName === "updateDocument" ? (
                              <DocumentToolResult
                                type="update"
                                isReadonly={false}
                                result={result}
                              />
                            ) : toolName === "requestSuggestions" ? (
                              <DocumentToolResult
                                type="request-suggestions"
                                isReadonly={false}
                                result={result}
                              />
                            ) : null}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={`tool-${toolCallId}`}
                          className={cx({
                            skeleton: ["getWeather"].includes(toolName),
                          })}
                        >
                          {toolName === "extract" ? (
                            <ExtractResults results={[]} isLoading={true} />
                          ) : toolName === "scrape" ? (
                            <ScrapeResults
                              url={args.url}
                              data=""
                              isLoading={true}
                            />
                          ) : toolName === "search" ? (
                            <SearchResults results={[]} isLoading={true} />
                          ) : toolName === "deepResearch" ? (
                            <DeepResearchProgress
                              state={state}
                              activity={
                                (
                                  toolInvocation as {
                                    state: string;
                                    delta?: {
                                      activity?: Array<{
                                        type: string;
                                        status: string;
                                        message: string;
                                        timestamp: string;
                                        depth?: number;
                                        completedSteps?: number;
                                        totalSteps?: number;
                                      }>;
                                    };
                                  }
                                ).state === "streaming" &&
                                (toolInvocation as any).delta?.activity
                                  ? [
                                      ...((toolInvocation as any).delta
                                        .activity || []),
                                    ]
                                  : []
                              }
                            />
                          ) : toolName === "createDocument" ? (
                            <DocumentPreview isReadonly={false} args={args} />
                          ) : toolName === "updateDocument" ? (
                            <DocumentToolCall
                              type="update"
                              args={args}
                              isReadonly={false}
                            />
                          ) : toolName === "requestSuggestions" ? (
                            <DocumentToolCall
                              type="request-suggestions"
                              args={args}
                              isReadonly={false}
                            />
                          ) : null}
                        </div>
                      );
                    } else if (part.type === "file") {
                      return (
                        <div key={`file-${index}`} className="file-container">
                          <Image
                            src={`data:${part.mimeType};base64,${part.data}`}
                            className="max-w-full max-h-[400px] rounded-md"
                            alt="File"
                          />
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}

            {(message.role === "assistant" || message.role === "user") && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                isLoading={isLoading}
                reload={reload}
                setMode={setMode}
                deleteMessage={deleteMessage}
              />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;

    return true;
  }
);

export const ThinkingMessage = () => {
  return (
    <motion.div
      className="w-full mx-auto max-w-3xl px-4 group/message "
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role="assistant"
    >
      <AnimatedGradientText className="text-base" text="Thinking..." />
    </motion.div>
  );
};

const DeepResearchProgress = ({
  state,
  activity,
}: {
  state: string;
  activity: Array<{
    type: string;
    status: string;
    message: string;
    timestamp: string;
    depth?: number;
    completedSteps?: number;
    totalSteps?: number;
  }>;
}) => {
  const { state: deepResearchState } = useDeepResearch();
  const [lastActivity, setLastActivity] = useState<string>("");
  const [startTime] = useState<number>(Date.now());
  const maxDuration = 5 * 60 * 1000; // 5 minutes in milliseconds
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activity && activity.length > 0) {
      const lastItem = activity[activity.length - 1];
      setLastActivity(lastItem.message);

      // Update progress from activity if available
      if (
        lastItem.completedSteps !== undefined &&
        lastItem.totalSteps !== undefined
      ) {
        deepResearchState.completedSteps = lastItem.completedSteps;
        deepResearchState.totalExpectedSteps = lastItem.totalSteps;
      }
    }
  }, [activity, deepResearchState]);

  // Calculate overall progress
  const progress = useMemo(() => {
    if (deepResearchState.totalExpectedSteps === 0) return 0;
    return Math.min(
      (deepResearchState.completedSteps /
        deepResearchState.totalExpectedSteps) *
        100,
      100
    );
  }, [deepResearchState.completedSteps, deepResearchState.totalExpectedSteps]);

  // Calculate time progress
  const timeProgress = useMemo(() => {
    const elapsed = currentTime - startTime;
    return Math.min((elapsed / maxDuration) * 100, 100);
  }, [currentTime, startTime, maxDuration]);

  // Get current phase
  const currentPhase = useMemo(() => {
    if (!activity.length) return "";
    const current = activity[activity.length - 1];
    switch (current.type) {
      case "search":
        return "Searching";
      case "extract":
        return "Extracting";
      case "analyze":
        return "Analyzing";
      case "synthesis":
        return "Synthesizing";
      default:
        return "Researching";
    }
  }, [activity]);

  // Format time
  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const timeUntilTimeout = Math.max(maxDuration - (currentTime - startTime), 0);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex flex-col gap-1">
          <span>Research in progress...</span>
          Depth: {deepResearchState.currentDepth}/{deepResearchState.maxDepth}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span>{Math.round(progress)}%</span>
          <span className="text-xs">
            Step {deepResearchState.completedSteps}/
            {deepResearchState.totalExpectedSteps}
          </span>
        </div>
      </div>
      <Progress value={progress} className="w-full" />
      <div className="flex items-center justify-end text-xs text-muted-foreground mt-2">
        <span>Time until timeout: {formatTime(timeUntilTimeout)}</span>
        <span>{Math.round(timeProgress)}% of max time used</span>
      </div>
      <Progress value={timeProgress} className="w-full" />
      <div className="text-xs text-muted-foreground">{lastActivity}</div>
    </div>
  );
};
