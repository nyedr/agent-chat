import { SearchResults } from "./search-results";

import { DocumentToolCall, DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { useEffect, useMemo, useState } from "react";

import { useDeepResearch } from "@/lib/deep-research-context";
import { ToolCall } from "./tool-call";
import { SearchResultItem, SearchToolResponse } from "@/lib/search/types";
import { Progress } from "./ui/progress";
import { motion } from "framer-motion";
import { DeepResearchResult } from "./deep-research-result";
import { calculateProgressPercentage, formatTime } from "@/lib/utils";

export const ToolResultRenderer = ({
  toolName,
  toolCallId,
  state,
  args,
  result,
  isLoading,
  chatId,
}: {
  toolName: string;
  toolCallId: string;
  state: string;
  args: any;
  result?: any;
  isLoading: boolean;
  chatId: string;
}) => {
  console.log("tool info", toolName, args, result, isLoading, chatId, state);

  // Handle loading states
  if (state !== "result" || isLoading) {
    switch (toolName) {
      case "search":
        return <SearchResults results={[]} isLoading={true} />;
      case "deepResearch":
        return <DeepResearchProgress state={state} />;
      case "createDocument":
        return (
          <DocumentPreview chatId={chatId} isReadonly={false} args={args} />
        );
      case "updateDocument":
        return (
          <DocumentToolCall type="update" args={args} isReadonly={false} />
        );
      case "requestSuggestions":
        return (
          <DocumentToolCall
            type="request-suggestions"
            args={args}
            isReadonly={false}
          />
        );
      default:
        return <ToolCall type="loading" args={args} toolName={toolName} />;
    }
  }

  // Handle results
  switch (toolName) {
    case "search":
      try {
        // Get search results data from the response with proper typing
        const searchData = (result as SearchToolResponse).data;

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
      if (result.success && result.data?.reportContent) {
        return <DeepResearchResult data={result.data} />;
      } else {
        return (
          <div className="text-sm text-muted-foreground">
            {result.success
              ? "Research completed, but no report content was found."
              : `Research failed: ${result.error || "Unknown error"}`}
          </div>
        );
      }
    case "createDocument":
      return (
        <DocumentPreview chatId={chatId} result={result} isReadonly={false} />
      );
    case "updateDocument":
      return (
        <DocumentToolResult type="update" isReadonly={false} result={result} />
      );
    case "requestSuggestions":
      return (
        <DocumentToolResult
          type="request-suggestions"
          isReadonly={false}
          result={result}
        />
      );
    default:
      return (
        <ToolCall
          type="complete"
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
  const maxDuration = 5 * 60 * 1000; // 5 minutes
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
