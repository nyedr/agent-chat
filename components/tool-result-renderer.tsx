import { SearchResults } from "./tools/search-results";

import { DocumentToolResult } from "./tools/document";
import { DocumentPreview } from "./tools/document-preview";
import React, { useEffect, useMemo, useState, memo } from "react";

import { useDeepResearch } from "@/lib/deep-research-context";
import { ToolCall } from "./tools/tool-call";
import { Progress } from "./ui/progress";
import { motion } from "framer-motion";
import { DeepResearchResult } from "./tools/deep-research-result";
import { calculateProgressPercentage, formatTime } from "@/lib/utils";
import fastDeepEqual from "fast-deep-equal";
import { PythonInterpreter } from "./tools/python-interpreter-result";
import { ToolName, ToolReturnTypes } from "@/lib/ai/tools";
import { ExtractStructuredDataResult } from "./tools/extract-structured-data-result";
import { ListDirectoryResult } from "./tools/list-directory-result";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { GetFileInfoResultComponent } from "./tools/get-file-info-result";
import { EditDocumentResultComponent } from "./tools/edit-document-result";
import { CodeBlock } from "./code-block";

const ToolResultRendererComponent = ({
  toolName,
  state,
  args,
  result,
  isLoading,
  chatId,
}: {
  toolName: ToolName;
  state: string;
  args: any;
  result?: ToolReturnTypes[typeof toolName];
  isLoading: boolean;
  chatId: string;
}) => {
  console.log("tool info", toolName, args, result, isLoading, chatId, state);

  let toolResult = result as ToolReturnTypes[typeof toolName];

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
      case "pythonInterpreter":
        return <PythonInterpreter args={args} isLoading={true} state={state} />;
      case "fileRead":
        return <DocumentPreview isReadonly={false} args={args} />;
      case "extractStructuredData":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            customMessage={
              args.url
                ? `Extracting data from ${args.url}...`
                : `Extracting data from file ${args.filePath}...`
            }
          />
        );
      case "listDirectory":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            customMessage={`Listing directory ${args.path || "/"}...`}
          />
        );
      case "deleteDocument":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Trash2 />}
            customMessage={`Deleting ${args.path}...`}
          />
        );
      case "getFileInfo":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Eye />}
            customMessage={`Getting info for ${args.path}...`}
          />
        );
      case "editDocument":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Pencil />}
            customMessage={`Editing ${args.path}...`}
          />
        );
      case "readDocument":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            customMessage={`Reading ${args.path}...`}
          />
        );
      case "shellExec":
        return <CodeBlock language="bash">{args.command}</CodeBlock>;
      default:
        return <ToolCall type="loading" args={args} toolName={toolName} />;
    }
  }

  switch (toolName) {
    case "scrapeUrl":
      toolResult = result as ToolReturnTypes[typeof toolName];

      return <SearchResults results={toolResult.data} />;
    case "searchWeb":
      try {
        toolResult = result as ToolReturnTypes[typeof toolName];

        return <SearchResults results={toolResult.results} />;
      } catch (error) {
        console.warn("Error displaying search results:", error);
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Search completed, but results couldn&apos;t be displayed.
          </div>
        );
      }
    case "deepResearch":
      const deepResearchResult = result as ToolReturnTypes["deepResearch"];
      return <DeepResearchResult data={deepResearchResult.data} />;
    case "createDocument":
      const createDocumentResult = result as ToolReturnTypes["createDocument"];
      return (
        <DocumentPreview isReadonly={false} result={createDocumentResult} />
      );
    case "pythonInterpreter":
      const pythonInterpreterResult =
        result as ToolReturnTypes["pythonInterpreter"];

      return (
        <PythonInterpreter
          args={args}
          result={pythonInterpreterResult}
          isLoading={false}
          state={state}
        />
      );
    case "fileRead":
    case "readDocument":
      const fileReadResult = result as
        | ToolReturnTypes["fileRead"]
        | ToolReturnTypes["readDocument"];

      return (
        <DocumentToolResult
          type="read"
          isReadonly={false}
          result={{
            id: "1",
            title: fileReadResult.title,
            kind: fileReadResult.kind,
            content: fileReadResult.content || "",
          }}
        />
      );
    case "deleteDocument":
      const fileOpResult = result as ToolReturnTypes["deleteDocument"];

      return (
        <ToolCall
          type={fileOpResult.success ? "success" : "error"}
          customMessage={fileOpResult.message}
          icon={<Trash2 />}
          args={args}
          result={result}
          toolName={toolName}
        />
      );
    case "extractStructuredData":
      const extractStructuredDataResult =
        result as ToolReturnTypes["extractStructuredData"];
      return (
        <ExtractStructuredDataResult result={extractStructuredDataResult} />
      );
    case "listDirectory":
      const listDirectoryResult = result as ToolReturnTypes["listDirectory"];
      return (
        <ListDirectoryResult result={listDirectoryResult} chatId={chatId} />
      );
    case "getFileInfo":
      toolResult = result as ToolReturnTypes[typeof toolName];
      return <GetFileInfoResultComponent result={toolResult} />;
    case "editDocument":
      const editDocumentResult = result as ToolReturnTypes["editDocument"];
      return <EditDocumentResultComponent result={editDocumentResult} />;
    case "shellExec":
      const shellExecResult = result as ToolReturnTypes["shellExec"];
      const exitCode = shellExecResult.exitCode;

      return (
        <CodeBlock
          useMinimal={false}
          result={
            exitCode === 0 ? shellExecResult.stdout : shellExecResult.stderr
          }
          language="bash"
        >
          {args.command}
        </CodeBlock>
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
