import { SearchResults } from "./search-results";
import { ExtractResults } from "./extract-results";
import { ScrapeResults } from "./scrape-results";

import { DocumentToolCall, DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { Progress } from "@radix-ui/react-progress";
import { formatTimeMS, calculateProgressPercentage } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

import { useDeepResearch } from "@/lib/deep-research-context";

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
  // Handle loading states
  if (state !== "result" || isLoading) {
    switch (toolName) {
      case "extract":
        return <ExtractResults results={[]} isLoading={true} />;
      case "scrape":
        return <ScrapeResults url={args.url} data="" isLoading={true} />;
      case "search":
        return <SearchResults results={[]} isLoading={true} />;
      case "deepResearch":
        return (
          <DeepResearchProgress
            state={state}
            activity={
              state === "streaming" && (args as any)?.delta?.activity
                ? [...((args as any).delta.activity || [])]
                : []
            }
          />
        );
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
        return null;
    }
  }

  // Handle results
  switch (toolName) {
    case "search":
      return (
        <SearchResults
          results={result.data.map((item: any) => ({
            title: item.title,
            url: item.url,
            description: item.description,
            source: new URL(item.url).hostname,
            favicon: item.favicon,
          }))}
        />
      );
    case "extract":
      return (
        <ExtractResults
          results={
            Array.isArray(result.data)
              ? result.data.map((item: any) => ({
                  url: item.url,
                  data: item.data,
                }))
              : { url: args.urls[0], data: result.data }
          }
          isLoading={false}
        />
      );
    case "scrape":
      return (
        <ScrapeResults url={args.url} data={result.data} isLoading={false} />
      );
    case "deepResearch":
      return (
        <div className="text-sm text-muted-foreground">
          {result.success
            ? "Research completed successfully."
            : `Research may have failed: ${result.error}`}
        </div>
      );
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
      return null;
  }
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
  const progress = useMemo(
    () =>
      calculateProgressPercentage(
        deepResearchState.completedSteps,
        deepResearchState.totalExpectedSteps
      ),
    [deepResearchState.completedSteps, deepResearchState.totalExpectedSteps]
  );

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
        <span>Time until timeout: {formatTimeMS(timeUntilTimeout)}</span>
        <span>{Math.round(timeProgress)}% of max time used</span>
      </div>
      <Progress value={timeProgress} className="w-full" />
      <div className="text-xs text-muted-foreground">{lastActivity}</div>
    </div>
  );
};
