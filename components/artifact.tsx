import type { Attachment, Message } from "ai";
import { formatDistance } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import useSWR from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";
import type { Document } from "@/lib/db/schema";
import { fetcher, cn, getFileIcon } from "@/lib/utils";
import { MultimodalInput } from "./multimodal-input";
import { ArtifactMessages } from "./artifact-messages";
import { useArtifact } from "@/hooks/use-artifact";
import { imageArtifact } from "@/artifacts/image/client";
import { codeArtifact } from "@/artifacts/code/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { htmlArtifact } from "@/artifacts/html/client";
import equal from "fast-deep-equal";
import type { UseChatHelpers } from "@ai-sdk/react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  X,
  Clock,
  Save,
  History,
  Download,
  Share2,
  MoreHorizontal,
  MessageSquare,
  ChevronRight,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "./ui/skeleton";

export const artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact,
  htmlArtifact,
];
export type ArtifactKind = (typeof artifactDefinitions)[number]["kind"];

export interface UIArtifact {
  title: string;
  documentId: string;
  kind: ArtifactKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
}

const formatVersionDate = (date: string | number | Date | undefined) => {
  if (!date) return "";
  return formatDistance(new Date(date), new Date(), { addSuffix: true });
};

function PureArtifact({
  chatId,
  input,
  setInput,
  handleSubmit,
  status,
  stop,
  attachments,
  setAttachments,
  append,
  messages,
  setMessages,
  reload,
}: {
  chatId: string;
  input: string;
  setInput: UseChatHelpers["setInput"];
  status: UseChatHelpers["status"];
  stop: UseChatHelpers["stop"];
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<Message>;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  append: UseChatHelpers["append"];
  handleSubmit: UseChatHelpers["handleSubmit"];
  reload: UseChatHelpers["reload"];
}) {
  const { artifact, setArtifact, metadata, setMetadata, hideArtifact } =
    useArtifact();

  const {
    data: documentsT,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Array<Document>>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const documents = documentsT?.reverse();

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(0);
  const [isContentDirty, setIsContentDirty] = useState(false);
  const [showChat, setShowChat] = useState(true);

  const { width: windowWidth } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  useEffect(() => {
    if (isMobile) {
      setShowChat(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (documents && documents.length > 0) {
      const currentDoc = documents[currentVersionIndex];
      if (currentDoc) {
        setDocument(currentDoc);
      } else {
        setDocument(null);
      }
    } else if (!isDocumentsFetching) {
      setCurrentVersionIndex(0);
      setDocument(null);
    }
  }, [
    documents,
    isDocumentsFetching,
    artifact.documentId,
    currentVersionIndex,
    setDocument,
  ]);

  useEffect(() => {
    if (documents && documents[currentVersionIndex]) {
      const newContent = documents[currentVersionIndex].content ?? "";
      if (artifact.content !== newContent) {
        setArtifact((prev) => ({ ...prev, content: newContent }));
      }
    }
  }, [currentVersionIndex, documents, setArtifact, artifact.content]);

  useEffect(() => {
    if (artifact.status === "idle") {
      mutateDocuments();
    }
  }, [artifact.status, mutateDocuments]);

  const IconComponent = getFileIcon(artifact.kind);

  const handleContentChange = useCallback(
    async (updatedContent: string) => {
      if (!artifact || artifact.documentId === "init") return;

      const latestDocument = documents?.[0];
      if (latestDocument && latestDocument.content === updatedContent) {
        setIsContentDirty(false);
        return;
      }

      if (currentVersionIndex !== 0) {
        console.warn(
          "Attempted to save while not on the latest version. Ignoring."
        );
        setIsContentDirty(false);
        return;
      }

      const optimisticDoc: Document = {
        id: latestDocument?.id ?? crypto.randomUUID(),
        chatId: chatId,
        title: artifact.title,
        content: updatedContent,
        kind: artifact.kind,
        createdAt: new Date().toISOString(),
        extension: latestDocument?.extension ?? "",
      };

      mutateDocuments(
        async (currentData) => {
          return currentData
            ? [optimisticDoc, ...currentData]
            : [optimisticDoc];
        },
        { revalidate: false }
      );

      try {
        const response = await fetch(
          `/api/document?id=${artifact.documentId}&chatId=${chatId}`,
          {
            method: "POST",
            body: JSON.stringify({
              title: artifact.title,
              content: updatedContent,
              kind: artifact.kind,
            }),
          }
        );

        if (!response.ok) {
          console.error("Failed to save document version");
          mutateDocuments();
        } else {
          setIsContentDirty(false);
          const newDocs = await mutateDocuments();
          if (newDocs) {
            setCurrentVersionIndex(0);
          }
        }
      } catch (error) {
        console.error("Error saving document:", error);
        mutateDocuments();
      }
    },
    [artifact, chatId, documents, mutateDocuments, currentVersionIndex]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    1500
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean = true) => {
      if (currentVersionIndex !== 0) {
        console.warn(
          "Cannot save content when not viewing the latest version."
        );
        return;
      }

      const currentDocContent = documents?.[0]?.content ?? artifact.content;

      if (updatedContent !== currentDocContent) {
        setIsContentDirty(true);
        setArtifact((prev) => ({ ...prev, content: updatedContent }));

        if (debounce) {
          debouncedHandleContentChange(updatedContent);
        } else {
          debouncedHandleContentChange.cancel();
          handleContentChange(updatedContent);
        }
      }
    },
    [
      documents,
      currentVersionIndex,
      artifact.content,
      setArtifact,
      debouncedHandleContentChange,
      handleContentChange,
    ]
  );

  function getDocumentContentByIndex(index: number): string {
    if (!documents || index < 0 || index >= documents.length) {
      return artifact.content ?? "";
    }
    return documents[index]?.content ?? "";
  }

  const handleVersionChange = (target: number | "next" | "prev" | "latest") => {
    if (!documents || documents.length <= 1) return;

    setIsContentDirty(false);
    debouncedHandleContentChange.cancel();

    let newIndex = currentVersionIndex;
    const oldestIndex = documents.length - 1;

    if (target === "latest") {
      newIndex = 0;
    } else if (target === "prev") {
      newIndex = Math.min(oldestIndex, currentVersionIndex + 1);
    } else if (target === "next") {
      newIndex = Math.max(0, currentVersionIndex - 1);
    } else if (typeof target === "number") {
      newIndex = Math.max(0, Math.min(oldestIndex, target));
    }

    if (newIndex !== currentVersionIndex) {
      setCurrentVersionIndex(newIndex);
    }
  };

  const isCurrentVersion = currentVersionIndex === 0;

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  useEffect(() => {
    if (
      artifact.documentId &&
      artifact.documentId !== "init" &&
      artifactDefinition?.initialize
    ) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata,
      });
    }
  }, [artifact.documentId, artifactDefinition, setMetadata, metadata]);

  if (!artifactDefinition) {
    return null;
  }

  const handleClose = () => {
    if (isContentDirty) {
      saveContent(artifact.content, false);
    }
    hideArtifact();
  };

  return (
    <AnimatePresence>
      {artifact.isVisible && artifact.documentId !== "init" && (
        <motion.div
          data-testid="artifact"
          className={cn(
            "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm",
            "p-0"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
        >
          <motion.div
            className={cn(
              "flex flex-col h-full w-full rounded-lg border shadow-lg bg-background overflow-hidden",
              "rounded-none border-0"
            )}
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center justify-between p-2 md:px-4 border-b bg-muted/30 shrink-0">
              <div className="flex items-center gap-2 md:gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={handleClose}
                >
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </Button>

                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="h-6 px-2 gap-1 text-xs font-normal shrink-0"
                  >
                    <IconComponent className="size-4" />
                    {artifact.kind.charAt(0).toUpperCase() +
                      artifact.kind.slice(1)}
                  </Badge>
                  <h2 className="text-sm font-medium truncate max-w-[150px] sm:max-w-[200px] md:max-w-xs lg:max-w-md">
                    {artifact.title || "Untitled"}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-1 md:gap-1.5">
                {!isMobile && (
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setShowChat(!showChat)}
                        >
                          <MessageSquare className="size-4" />
                          <span className="sr-only">
                            {showChat ? "Hide Chat" : "Show Chat"}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {showChat ? "Hide Chat" : "Show Chat"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8">
                      <MoreHorizontal className="size-4" />
                      <span className="sr-only">More options</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled
                      className="flex items-center gap-2"
                    >
                      <Download className="size-4" />
                      <span>Download</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled
                      className="flex items-center gap-2"
                    >
                      <Share2 className="size-4" />
                      <span>Share</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {!isMobile && showChat ? (
                <ResizablePanelGroup direction="horizontal" className="w-full">
                  <ResizablePanel defaultSize={30} minSize={25} maxSize={50}>
                    <div className="flex flex-col h-full border-r bg-muted/20">
                      <div className="p-3 border-b bg-muted/30 flex items-center justify-between shrink-0">
                        <h3 className="text-sm font-medium">Chat</h3>
                        {status === "streaming" && (
                          <Badge
                            variant="outline"
                            className="h-6 text-xs px-1.5 animate-pulse"
                          >
                            Typing...
                          </Badge>
                        )}
                      </div>

                      <div className="flex-1 overflow-y-auto p-3">
                        <ArtifactMessages
                          chatId={chatId}
                          isLoading={status === "streaming"}
                          messages={messages}
                          setMessages={setMessages}
                          reload={reload}
                          artifactStatus={artifact.status}
                        />
                      </div>

                      <div className="p-3 border-t bg-muted/30 shrink-0">
                        <MultimodalInput
                          append={append}
                          searchMode="agent"
                          setSearchMode={() => {}}
                          chatId={chatId}
                          input={input}
                          setInput={setInput}
                          handleSubmit={(e, opts) => {
                            handleSubmit(e, opts);
                            return Promise.resolve();
                          }}
                          isLoading={status === "streaming"}
                          stop={stop}
                          attachments={attachments}
                          setAttachments={setAttachments}
                          messages={messages}
                          className="bg-background"
                          setMessages={setMessages}
                        />
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={70}>
                    <ArtifactContent
                      artifact={artifact}
                      setMode={setMode}
                      artifactDefinition={artifactDefinition}
                      isContentDirty={isContentDirty}
                      document={document}
                      currentVersionIndex={currentVersionIndex}
                      isCurrentVersion={isCurrentVersion}
                      mode={mode}
                      metadata={metadata}
                      setMetadata={setMetadata}
                      getDocumentContentByIndex={getDocumentContentByIndex}
                      isDocumentsFetching={isDocumentsFetching}
                      saveContent={saveContent}
                      documents={documents}
                      handleVersionChange={handleVersionChange}
                      appendMessage={append}
                      setMessages={setMessages}
                      setArtifact={setArtifact}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <ArtifactContent
                  artifact={artifact}
                  setMode={setMode}
                  artifactDefinition={artifactDefinition}
                  isContentDirty={isContentDirty}
                  document={document}
                  currentVersionIndex={currentVersionIndex}
                  isCurrentVersion={isCurrentVersion}
                  mode={mode}
                  metadata={metadata}
                  setMetadata={setMetadata}
                  getDocumentContentByIndex={getDocumentContentByIndex}
                  isDocumentsFetching={isDocumentsFetching}
                  saveContent={saveContent}
                  documents={documents}
                  handleVersionChange={handleVersionChange}
                  appendMessage={append}
                  setMessages={setMessages}
                  setArtifact={setArtifact}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ArtifactContentProps {
  artifact: UIArtifact;
  artifactDefinition: (typeof artifactDefinitions)[number];
  isContentDirty: boolean;
  document: Document | null;
  currentVersionIndex: number;
  isCurrentVersion: boolean;
  mode: "edit" | "diff";
  metadata: Record<string, any>;
  setMetadata: Dispatch<SetStateAction<Record<string, any>>>;
  getDocumentContentByIndex: (index: number) => string;
  isDocumentsFetching: boolean;
  saveContent: (content: string, debounce?: boolean) => void;
  documents: Array<Document> | undefined;
  handleVersionChange: (target: number | "next" | "prev" | "latest") => void;
  setMode: Dispatch<SetStateAction<"edit" | "diff">>;
  appendMessage: UseChatHelpers["append"];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setArtifact: Dispatch<SetStateAction<UIArtifact>>;
}

function ArtifactContent({
  artifact,
  artifactDefinition,
  isContentDirty,
  document,
  currentVersionIndex,
  isCurrentVersion,
  mode,
  metadata,
  setMetadata,
  getDocumentContentByIndex,
  isDocumentsFetching,
  saveContent,
  documents,
  handleVersionChange,
  setMode,
  appendMessage,
  setMessages,
  setArtifact,
}: ArtifactContentProps) {
  const totalVersions = documents ? documents.length : 0;
  const displayVersionNumber =
    totalVersions > 0 ? totalVersions - currentVersionIndex : 1;
  const oldestIndex = totalVersions > 0 ? totalVersions - 1 : 0;

  return (
    <div className="flex flex-col size-full bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0 min-h-[45px]">
        <div className="flex items-center gap-2 min-w-0">
          {isContentDirty ? (
            <div className="flex items-center text-xs text-muted-foreground gap-1 animate-pulse">
              <Save className="size-3.5" />
              <span>Saving...</span>
            </div>
          ) : document ? (
            <div className="flex items-center text-xs text-muted-foreground gap-1">
              <Clock className="size-3.5" />
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate max-w-[150px] sm:max-w-[200px]">
                      {`Updated ${formatVersionDate(document.createdAt)}`}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {new Date(document.createdAt).toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ) : isDocumentsFetching ? (
            <Skeleton className="w-32 h-4 bg-muted-foreground/10" />
          ) : (
            <div className="flex items-center text-xs text-muted-foreground gap-1">
              <span>No version history</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 md:gap-2 shrink-0">
          {documents &&
            documents.length > 1 &&
            currentVersionIndex !== oldestIndex && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs font-normal px-2"
                onClick={() => setMode(mode === "diff" ? "edit" : "diff")}
              >
                {mode === "diff" ? "View Edit" : "View Changes"}
              </Button>
            )}

          {artifact.kind === "code" && (
            <Tabs
              value={metadata?.viewMode || "code"}
              onValueChange={(value) =>
                setMetadata((prev) => ({ ...prev, viewMode: value }))
              }
              className="h-8"
            >
              <TabsList className="h-7 p-0.5">
                <TabsTrigger
                  value="code"
                  className="text-xs px-2 h-6 data-[state=active]:bg-background"
                >
                  Code
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="text-xs px-2 h-6 data-[state=active]:bg-background"
                >
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {documents && documents.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs text-nowrap font-normal px-2"
                >
                  <History className="size-3.5" />
                  <span>
                    Version {displayVersionNumber}
                    {isCurrentVersion
                      ? " (Latest)"
                      : currentVersionIndex === oldestIndex
                      ? " (Oldest)"
                      : ""}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-60 overflow-y-auto"
              >
                {documents.map((doc, index) => {
                  const versionNum = totalVersions - index;
                  const isLatest = index === 0;
                  const isOldest = index === oldestIndex;
                  return (
                    <DropdownMenuItem
                      key={doc.id || index}
                      className={cn(
                        "flex justify-between text-nowrap",
                        currentVersionIndex === index && "bg-muted font-medium"
                      )}
                      onClick={() => handleVersionChange(index)}
                    >
                      <span>
                        Version {versionNum}
                        {isLatest ? " (Latest)" : isOldest ? " (Oldest)" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {formatVersionDate(doc.createdAt)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        <div
          className={cn("h-full w-full", {
            "p-4 md:py-8 lg:p-12": artifact.kind === "text",
            "p-0":
              artifact.kind === "code" ||
              artifact.kind === "sheet" ||
              artifact.kind === "html",
            "flex items-center justify-center p-4": artifact.kind === "image",
          })}
        >
          <div
            className={cn("h-full w-full", {
              "mx-auto max-w-4xl": artifact.kind === "text",
            })}
          >
            {isDocumentsFetching &&
            !artifact.content &&
            currentVersionIndex === -1 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-4">
                  <div className="size-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    Loading document...
                  </p>
                </div>
              </div>
            ) : (
              <artifactDefinition.content
                title={artifact.title}
                content={getDocumentContentByIndex(currentVersionIndex)}
                mode={mode}
                status={artifact.status}
                currentVersionIndex={currentVersionIndex}
                onSaveContent={(newContent) => saveContent(newContent, true)}
                isInline={false}
                isCurrentVersion={isCurrentVersion}
                getDocumentContentById={(index: number) =>
                  getDocumentContentByIndex(index)
                }
                isLoading={isDocumentsFetching && !document}
                metadata={metadata as any}
                setMetadata={setMetadata}
                setArtifact={setArtifact}
              />
            )}
          </div>
        </div>

        {!isCurrentVersion && documents && documents.length > 1 && (
          <div className="sticky bottom-0 inset-x-0 p-2 md:p-3 bg-muted/80 backdrop-blur-sm border-t flex items-center justify-between z-10">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="h-6 gap-1 text-xs font-normal px-2"
              >
                <History className="size-3.5" />
                Viewing Version {displayVersionNumber}
                {currentVersionIndex === oldestIndex ? " (Oldest)" : ""}
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {document && formatVersionDate(document.createdAt)}
              </span>
            </div>

            <div className="flex items-center gap-1 md:gap-2">
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleVersionChange("prev")}
                      disabled={currentVersionIndex >= oldestIndex}
                    >
                      <ChevronLeft className="size-4" />
                      <span className="sr-only">Older version</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Older Version</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => handleVersionChange("next")}
                disabled={isCurrentVersion}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Newer version</span>
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7"
                onClick={() => handleVersionChange("latest")}
                disabled={isCurrentVersion}
              >
                Go to Latest
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.input !== nextProps.input) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.attachments, nextProps.attachments)) return false;

  return true;
});
