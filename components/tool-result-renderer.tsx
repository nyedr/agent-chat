import { SearchResults } from "./search-results";

import { DocumentToolCall, DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import React, { useEffect, useMemo, useState, memo } from "react";

import { useDeepResearch } from "@/lib/deep-research-context";
import { ToolCall } from "./tool-call";
import { SearchResultItem, SearchToolResponse } from "@/lib/search/types";
import { Progress } from "./ui/progress";
import { motion } from "framer-motion";
import { DeepResearchResult } from "./deep-research-result";
import { calculateProgressPercentage, formatTime } from "@/lib/utils";
import fastDeepEqual from "fast-deep-equal";
import { PythonInterpreter } from "./python-interpreter";
import { AllowedTool, AllowedToolTypes } from "@/app/(chat)/api/chat/route";

const ToolResultRendererComponent = ({
  toolName,
  state,
  args,
  result,
  isLoading,
  chatId,
}: {
  toolName: AllowedTool;
  state: string;
  args: any;
  result?: AllowedToolTypes[typeof toolName];
  isLoading: boolean;
  chatId: string;
}) => {
  console.log("tool info", toolName, args, result, isLoading, chatId, state);

  let toolResult = result as AllowedToolTypes[typeof toolName];

  if (state !== "result" || isLoading) {
    switch (toolName) {
      case "scrapeUrl":
      case "searchWeb":
        return (
          <SearchResults
            searchTitle={
              toolName === "scrapeUrl"
                ? `Scraping ${args.url}...`
                : "Searching the web..."
            }
            results={[]}
            isLoading={true}
          />
        );
      case "deepResearch":
        return <DeepResearchProgress state={state} />;
      case "createDocument":
        return <DocumentPreview isReadonly={false} args={args} />;
      case "updateDocument":
        return (
          <DocumentToolCall type="update" args={args} isReadonly={false} />
        );
      case "pythonInterpreter":
        return <PythonInterpreter args={args} isLoading={true} state={state} />;
      case "fileWrite":
        return <DocumentPreview isReadonly={false} args={args} />;
      case "fileRead":
        return <DocumentPreview isReadonly={false} args={args} />;
      default:
        return <ToolCall type="loading" args={args} toolName={toolName} />;
    }
  }

  switch (toolName) {
    case "scrapeUrl":
    case "searchWeb":
      try {
        toolResult = result as AllowedToolTypes[typeof toolName];
        const searchData = (toolResult as SearchToolResponse).data;

        return (
          <SearchResults
            results={searchData.map(
              (item) =>
                ({
                  title: item.title || "Untitled",
                  url: item.url || "#",
                  description: item.description || "",
                  source: item.source || "Unknown",
                  favicon: item.favicon,
                  publishedDate: item.publishedDate,
                } as SearchResultItem)
            )}
          />
        );
      } catch (error) {
        console.warn("Error displaying search results:", error);
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Search completed, but results couldn&apos;t be displayed.
          </div>
        );
      }
    case "deepResearch":
      toolResult = result as AllowedToolTypes[typeof toolName];
      return <DeepResearchResult data={toolResult.data} />;
    case "createDocument":
      toolResult = result as AllowedToolTypes[typeof toolName];
      return <DocumentPreview isReadonly={false} result={toolResult} />;
    case "updateDocument":
      toolResult = result as AllowedToolTypes[typeof toolName];

      if (toolResult.error) {
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Error updating document: {toolResult.error}
          </div>
        );
      }

      return (
        <DocumentToolResult
          type="update"
          isReadonly={false}
          result={{
            id: toolResult.id,
            title: toolResult.title || "Untitled",
            kind: toolResult.kind || "text",
            content: toolResult.content || "",
          }}
        />
      );
    case "pythonInterpreter":
      toolResult = result as AllowedToolTypes[typeof toolName];

      return (
        <PythonInterpreter
          args={args}
          result={toolResult}
          isLoading={false}
          state={state}
        />
      );
    case "fileWrite":
      toolResult = result as AllowedToolTypes[typeof toolName];

      if (toolResult?.error) {
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Error writing file: {toolResult.error}
          </div>
        );
      }

      return (
        <DocumentToolResult
          type="create"
          isReadonly={false}
          result={{
            id: "1",
            title: toolResult.title,
            kind: toolResult.kind,
            content: toolResult.content,
          }}
        />
      );
    case "fileRead":
      toolResult = result as AllowedToolTypes[typeof toolName];

      return (
        <DocumentToolResult
          type="read"
          isReadonly={false}
          result={{
            id: "1",
            title: toolResult.title,
            kind: toolResult.kind,
            content: toolResult.content,
          }}
        />
      );
    default:
      return (
        <ToolCall
          type="success"
          args={args}
          result={result}
          toolName={toolName}
        />
      );
  }
};

const DeepResearchProgress: React.FC<{ state: string }> = ({ state }) => {
  const { state: deepResearchState } = useDeepResearch();

  const progress = useMemo(
    () =>
      calculateProgressPercentage(
        deepResearchState.completedSteps,
        deepResearchState.totalExpectedSteps
      ),
    [deepResearchState.completedSteps, deepResearchState.totalExpectedSteps]
  );

  const [startTime] = useState<number>(Date.now());
  const maxDuration = 5 * 60 * 1000;
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = useMemo(
    () => Math.min(currentTime - startTime, maxDuration),
    [currentTime, startTime, maxDuration]
  );
  const formattedTimeElapsed = formatTime(elapsed);
  const formattedMaxDuration = formatTime(maxDuration);

  const currentActivity =
    deepResearchState.activity.length > 0
      ? deepResearchState.activity[deepResearchState.activity.length - 1]
          .message
      : "Initializing research...";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full space-y-4 rounded-xl border bg-card p-5 text-card-foreground shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm text-foreground">
          Research in progress...
        </span>
        <div className="flex items-center space-x-2 text-xs text-muted-foreground">
          <span>
            Depth: {deepResearchState.currentDepth}/{deepResearchState.maxDepth}
          </span>
          <span>•</span>
          <span>
            Step: {deepResearchState.completedSteps}/
            {deepResearchState.totalExpectedSteps}
          </span>
        </div>
      </div>

      <Progress max={100} value={progress} className="w-full h-2" />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Time Elapsed: {formattedTimeElapsed} / {formattedMaxDuration}
        </span>
      </div>

      <div className="border-t border-border/70 pt-2 text-xs text-muted-foreground">
        <span className="font-medium">Current Step:</span> {currentActivity}
      </div>
    </motion.div>
  );
};

export const ToolResultRenderer = memo(
  ToolResultRendererComponent,
  (prevProps: any, nextProps: any) => {
    if (
      prevProps.toolName !== nextProps.toolName ||
      prevProps.toolCallId !== nextProps.toolCallId ||
      prevProps.state !== nextProps.state ||
      prevProps.isLoading !== nextProps.isLoading ||
      prevProps.chatId !== nextProps.chatId
    ) {
      return false;
    }

    try {
      if (!fastDeepEqual(prevProps.args, nextProps.args)) {
        return false;
      }
      if (!fastDeepEqual(prevProps.result, nextProps.result)) {
        return false;
      }
    } catch (e) {
      console.error("Memo comparison error:", e);
      return false;
    }

    return true;
  }
);
