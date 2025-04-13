import { SearchResults } from "./tools/search-results";

import { DocumentToolCall, DocumentToolResult } from "./tools/document";
import { DocumentPreview } from "./tools/document-preview";
import React, { useEffect, useMemo, useState, memo } from "react";

import { useDeepResearch } from "@/lib/deep-research-context";
import { ToolCall } from "./tools/tool-call";
import { Progress } from "./ui/progress";
import { motion } from "framer-motion";
import { DeepResearchResult } from "./tools/deep-research-result";
import {
  calculateProgressPercentage,
  fileTypeToArtifactKind,
  formatTime,
  getFileInfoFromUrl,
} from "@/lib/utils";
import fastDeepEqual from "fast-deep-equal";
import { PythonInterpreter } from "./tools/python-interpreter";
import { ToolName, ToolReturnTypes } from "@/lib/ai/tools";
import { ExtractStructuredDataResult } from "./tools/extract-structured-data-result";
import { ListDirectoryResult } from "./tools/list-directory-result";
import { Eye, Folder, MoveHorizontal, Pencil, Trash2 } from "lucide-react";
import { FilePreview } from "./file-preview";
import { GetFileInfoResultComponent } from "./tools/get-file-info-result";
import { EditFileResultComponent } from "./tools/edit-file-result";

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
      case "deleteFile":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Trash2 />}
            customMessage={`Deleting ${args.path}...`}
          />
        );
      case "moveOrRenameFile":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<MoveHorizontal />}
            customMessage={`Moving ${args.sourcePath} to ${args.destinationPath}...`}
          />
        );
      case "createDirectory":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Folder />}
            customMessage={`Creating directory ${args.path}...`}
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
      case "editFile":
        return (
          <ToolCall
            type="loading"
            args={args}
            toolName={toolName}
            icon={<Pencil />}
            customMessage={`Editing ${args.path}...`}
          />
        );
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
    case "updateDocument":
      const updateDocumentResult = result as ToolReturnTypes["updateDocument"];

      if (updateDocumentResult.error) {
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Error updating document: {updateDocumentResult.error}
          </div>
        );
      }

      return (
        <DocumentToolResult
          type="update"
          isReadonly={false}
          result={{
            id: updateDocumentResult.id,
            title: updateDocumentResult.title || "Untitled",
            kind: updateDocumentResult.kind || "text",
            content: updateDocumentResult.content || "",
          }}
        />
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
    case "fileWrite":
      if (result && "file_path" in result) {
        const fileWriteResult = result as ToolReturnTypes["fileWrite"];
        if (fileWriteResult.error) {
          return (
            <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
              Error writing file: {fileWriteResult.error}
            </div>
          );
        }

        const fileUrl = fileWriteResult.file_path || "";
        const { fileType } = getFileInfoFromUrl(fileUrl, fileWriteResult.title);

        const fileName =
          fileWriteResult.file_path?.split("/").pop() || fileWriteResult.title;

        return (
          <FilePreview
            filename={fileName}
            url={fileUrl}
            viewable={!!fileTypeToArtifactKind[fileType]}
          />
        );
      } else {
        return (
          <div className="text-sm text-muted-foreground px-3 py-2 rounded-lg border bg-background">
            Error displaying file write result: Invalid data structure.
          </div>
        );
      }
    case "fileRead":
      const fileReadResult = result as ToolReturnTypes["fileRead"];

      return (
        <DocumentToolResult
          type="read"
          isReadonly={false}
          result={{
            id: "1",
            title: fileReadResult.title,
            kind: fileReadResult.kind,
            content: fileReadResult.content,
          }}
        />
      );
    case "moveOrRenameFile":
    case "deleteFile":
      toolResult = result as ToolReturnTypes[typeof toolName];
      const fileOpResult = result as
        | ToolReturnTypes["deleteFile"]
        | ToolReturnTypes["moveOrRenameFile"];

      return (
        <ToolCall
          type={fileOpResult.success ? "success" : "error"}
          customMessage={fileOpResult.message}
          icon={toolName === "deleteFile" ? <Trash2 /> : <MoveHorizontal />}
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
    case "createDirectory":
      return (
        <ToolCall
          type="success"
          args={args}
          result={result}
          toolName={toolName}
        />
      );
    case "getFileInfo":
      toolResult = result as ToolReturnTypes[typeof toolName];
      return <GetFileInfoResultComponent result={toolResult} />;
    case "editFile":
      const editFileResult = result as ToolReturnTypes[typeof toolName];
      return <EditFileResultComponent result={editFileResult} />;
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
