import type {
  Attachment,
  ChatRequestOptions,
  CreateMessage,
  Message,
} from "ai";
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
import useSWR, { useSWRConfig } from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";

import type { Document, Suggestion } from "@/lib/db/schema";
import { cn, fetcher } from "@/lib/utils";

import { DiffView } from "./diffview";
import { DocumentSkeleton } from "./document-skeleton";
import { Editor } from "./editor";
import { MultimodalInput, SearchMode } from "./multimodal-input";
import { Toolbar } from "./toolbar";
import { VersionFooter } from "./version-footer";
import { BlockActions } from "./block-actions";
import { BlockCloseButton } from "./block-close-button";
import { BlockMessages } from "./block-messages";
import { CodeEditor } from "./code-editor";
import { Console } from "./console";
import { useSidebar } from "./ui/sidebar";
import { useBlock } from "@/hooks/use-block";
import equal from "fast-deep-equal";
import { SpreadsheetEditor } from "./spreadsheet-editor";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

/** Type representing the possible block kinds: 'text' | 'code' | 'spreadsheet' */
export type BlockKind = "text" | "code" | "spreadsheet";

export const BLOCK_KINDS: BlockKind[] = ["text", "code", "spreadsheet"];

export interface UIBlock {
  title: string;
  documentId: string;
  kind: BlockKind;
  content: string;
  isVisible: boolean;
  status: "streaming" | "idle";
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface ConsoleOutputContent {
  type: "text" | "image";
  value: string;
}

export interface ConsoleOutput {
  id: string;
  status: "in_progress" | "loading_packages" | "completed" | "failed";
  contents: Array<ConsoleOutputContent>;
}

function PureBlock({
  chatId,
  input,
  setInput,
  handleSubmit,
  isLoading,
  stop,
  attachments,
  setAttachments,
  append,
  messages,
  setMessages,
  reload,
  searchMode,
  setSearchMode,
}: {
  chatId: string;
  input: string;
  setInput: (input: string) => void;
  isLoading: boolean;
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<Message>;
  setMessages: Dispatch<SetStateAction<Array<Message>>>;
  append: (
    message: Message | CreateMessage,
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  handleSubmit: (
    event?: {
      preventDefault?: () => void;
    },
    chatRequestOptions?: ChatRequestOptions
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
}) {
  const { block, setBlock } = useBlock();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Array<Document>>(
    block.documentId !== "init" && block.status !== "streaming"
      ? `/api/document?id=${block.documentId}`
      : null,
    fetcher
  );

  const { data: suggestions } = useSWR<Array<Suggestion>>(
    documents && block && block.status !== "streaming"
      ? `/api/suggestions?documentId=${block.documentId}`
      : null,
    fetcher,
    {
      dedupingInterval: 5000,
    }
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [consoleOutputs, setConsoleOutputs] = useState<Array<ConsoleOutput>>(
    []
  );

  const { open: isSidebarOpen } = useSidebar();

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        setBlock((currentBlock) => ({
          ...currentBlock,
          content: mostRecentDocument.content ?? "",
        }));
      }
    }
  }, [documents, setBlock]);

  useEffect(() => {
    mutateDocuments();
  }, [block.status, mutateDocuments]);

  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!block) return;

      mutate<Array<Document>>(
        `/api/document?id=${block.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) return undefined;

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument || !currentDocument.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content !== updatedContent) {
            await fetch(`/api/document?id=${block.documentId}`, {
              method: "POST",
              body: JSON.stringify({
                title: block.title,
                content: updatedContent,
                kind: block.kind,
              }),
            });

            setIsContentDirty(false);

            const newDocument = {
              ...currentDocument,
              content: updatedContent,
              createdAt: new Date().toISOString(),
            };

            return [...currentDocuments, newDocument];
          }
          return currentDocuments;
        },
        { revalidate: false }
      );
    },
    [block, mutate]
  );

  const debouncedHandleContentChange = useDebounceCallback(
    handleContentChange,
    2000
  );

  const saveContent = useCallback(
    (updatedContent: string, debounce: boolean) => {
      if (document && updatedContent !== document.content) {
        setIsContentDirty(true);

        if (debounce) {
          debouncedHandleContentChange(updatedContent);
        } else {
          handleContentChange(updatedContent);
        }
      }
    },
    [document, debouncedHandleContentChange, handleContentChange]
  );

  function getDocumentContentById(index: number) {
    if (!documents) return "";
    if (!documents[index]) return "";
    return documents[index].content ?? "";
  }

  const handleVersionChange = (type: "next" | "prev" | "toggle" | "latest") => {
    if (!documents) return;

    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }

    if (type === "toggle") {
      setMode((mode) => (mode === "edit" ? "diff" : "edit"));
    }

    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next") {
      if (currentVersionIndex < documents.length - 1) {
        setCurrentVersionIndex((index) => index + 1);
      }
    }
  };

  const [isToolbarVisible, setIsToolbarVisible] = useState(false);

  /*
   * NOTE: if there are no documents, or if
   * the documents are being fetched, then
   * we mark it as the current version.
   */

  const isCurrentVersion =
    documents && documents.length > 0
      ? currentVersionIndex === documents.length - 1
      : true;

  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;

  return (
    <AnimatePresence>
      {block.isVisible && (
        <motion.div
          className="flex flex-row h-dvh w-dvw fixed top-0 left-0 z-50 bg-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { delay: 0.4 } }}
        >
          {isMobile ? (
            <>
              <motion.div
                className="fixed bg-background h-dvh w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
              <motion.div
                className="absolute top-0 left-0 dark:bg-muted bg-background h-dvh w-full flex flex-col overflow-y-scroll"
                initial={{
                  opacity: 1,
                  x: block.boundingBox.left,
                  y: block.boundingBox.top,
                  height: block.boundingBox.height,
                  width: block.boundingBox.width,
                  borderRadius: 50,
                }}
                animate={{
                  opacity: 1,
                  x: 0,
                  y: 0,
                  height: windowHeight,
                  width: windowWidth ? windowWidth : "100dvw",
                  borderRadius: 0,
                  transition: {
                    delay: 0,
                    type: "spring",
                    stiffness: 200,
                    damping: 30,
                    duration: 5000,
                  },
                }}
                exit={{
                  opacity: 0,
                  scale: 0.5,
                  transition: {
                    delay: 0.1,
                    type: "spring",
                    stiffness: 600,
                    damping: 30,
                  },
                }}
              >
                <div className="p-2 flex flex-row justify-between items-start">
                  <div className="flex flex-row gap-4 items-start">
                    <BlockCloseButton />
                    <div className="flex flex-col">
                      <div className="font-medium">{block.title}</div>
                      {isContentDirty ? (
                        <div className="text-sm text-muted-foreground">
                          Saving changes...
                        </div>
                      ) : document ? (
                        <div className="text-sm text-muted-foreground">
                          {`Updated ${formatDistance(
                            new Date(document.createdAt),
                            new Date(),
                            {
                              addSuffix: true,
                            }
                          )}`}
                        </div>
                      ) : (
                        <div className="w-32 h-3 mt-2 bg-muted-foreground/20 rounded-md animate-pulse" />
                      )}
                    </div>
                  </div>
                  <BlockActions
                    block={block}
                    currentVersionIndex={currentVersionIndex}
                    handleVersionChange={handleVersionChange}
                    isCurrentVersion={isCurrentVersion}
                    mode={mode}
                    setConsoleOutputs={setConsoleOutputs}
                  />
                </div>

                <div
                  className={cn(
                    "dark:bg-muted bg-background h-full overflow-y-scroll !max-w-full pb-40 items-center",
                    {
                      "py-2 px-2": block.kind === "code",
                      "py-8 md:p-20 px-4": block.kind === "text",
                      "w-full": block.kind === "spreadsheet",
                    }
                  )}
                >
                  <div
                    className={cn("flex flex-row", {
                      "": block.kind === "code",
                      "mx-auto max-w-[600px]": block.kind === "text",
                    })}
                  >
                    {isDocumentsFetching && !block.content ? (
                      <DocumentSkeleton />
                    ) : block.kind === "code" ? (
                      <CodeEditor
                        content={
                          isCurrentVersion
                            ? block.content
                            : getDocumentContentById(currentVersionIndex)
                        }
                        isCurrentVersion={isCurrentVersion}
                        currentVersionIndex={currentVersionIndex}
                        suggestions={suggestions ?? []}
                        status={block.status}
                        saveContent={saveContent}
                      />
                    ) : block.kind === "text" ? (
                      mode === "edit" ? (
                        <Editor
                          content={
                            isCurrentVersion
                              ? block.content
                              : getDocumentContentById(currentVersionIndex)
                          }
                          isCurrentVersion={isCurrentVersion}
                          currentVersionIndex={currentVersionIndex}
                          status={block.status}
                          saveContent={saveContent}
                          suggestions={
                            isCurrentVersion ? suggestions ?? [] : []
                          }
                        />
                      ) : (
                        <DiffView
                          oldContent={getDocumentContentById(
                            currentVersionIndex - 1
                          )}
                          newContent={getDocumentContentById(
                            currentVersionIndex
                          )}
                        />
                      )
                    ) : block.kind === "spreadsheet" ? (
                      <SpreadsheetEditor
                        content={
                          isCurrentVersion
                            ? block.content
                            : getDocumentContentById(currentVersionIndex)
                        }
                        isCurrentVersion={isCurrentVersion}
                        currentVersionIndex={currentVersionIndex}
                        status={block.status}
                        saveContent={saveContent}
                      />
                    ) : null}

                    <AnimatePresence>
                      {isCurrentVersion && (
                        <Toolbar
                          isToolbarVisible={isToolbarVisible}
                          setIsToolbarVisible={setIsToolbarVisible}
                          append={append}
                          isLoading={isLoading}
                          stop={stop}
                          setMessages={setMessages}
                          blockKind={block.kind}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <AnimatePresence>
                  {!isCurrentVersion && (
                    <VersionFooter
                      currentVersionIndex={currentVersionIndex}
                      documents={documents}
                      handleVersionChange={handleVersionChange}
                    />
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  <Console
                    consoleOutputs={consoleOutputs}
                    setConsoleOutputs={setConsoleOutputs}
                  />
                </AnimatePresence>

                <div className="flex flex-row gap-2 relative items-end w-full py-4 mt-auto">
                  <MultimodalInput
                    searchMode={searchMode}
                    setSearchMode={setSearchMode}
                    chatId={chatId}
                    input={input}
                    setInput={setInput}
                    handleSubmit={handleSubmit}
                    isLoading={isLoading}
                    stop={stop}
                    attachments={attachments}
                    setAttachments={setAttachments}
                    messages={messages}
                    append={append}
                    className="bg-background dark:bg-muted"
                    setMessages={setMessages}
                  />
                </div>
              </motion.div>
            </>
          ) : (
            <ResizablePanelGroup direction="horizontal" className="h-dvh w-dvw">
              <ResizablePanel defaultSize={35} minSize={20} maxSize={50}>
                <div className="relative bg-muted dark:bg-background h-dvh flex flex-col justify-between items-center gap-4">
                  <AnimatePresence>
                    {!isCurrentVersion && (
                      <motion.div
                        className="left-0 absolute h-dvh w-full top-0 bg-zinc-900/50 z-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      />
                    )}
                  </AnimatePresence>

                  <BlockMessages
                    chatId={chatId}
                    isLoading={isLoading}
                    messages={messages}
                    setMessages={setMessages}
                    reload={reload}
                    blockStatus={block.status}
                  />

                  <div className="flex flex-row gap-2 relative items-end w-full py-4">
                    <MultimodalInput
                      searchMode={searchMode}
                      setSearchMode={setSearchMode}
                      chatId={chatId}
                      input={input}
                      setInput={setInput}
                      handleSubmit={handleSubmit}
                      isLoading={isLoading}
                      stop={stop}
                      attachments={attachments}
                      setAttachments={setAttachments}
                      messages={messages}
                      append={append}
                      className="bg-background dark:bg-muted"
                      setMessages={setMessages}
                    />
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={75} minSize={30}>
                <motion.div
                  className="dark:bg-muted bg-background h-dvh flex flex-col overflow-y-scroll"
                  exit={{
                    opacity: 0,
                    scale: 0.95,
                    transition: {
                      delay: 0.1,
                      duration: 0.2,
                    },
                  }}
                >
                  <div className="p-2 flex flex-row justify-between items-start sticky top-0 bg-background/80 dark:bg-muted/80 backdrop-blur-sm z-10 border-b">
                    <div className="flex flex-row gap-4 items-start">
                      <BlockCloseButton />
                      <div className="flex flex-col">
                        <div className="font-medium">{block.title}</div>
                        {isContentDirty ? (
                          <div className="text-sm text-muted-foreground">
                            Saving changes...
                          </div>
                        ) : document ? (
                          <div className="text-sm text-muted-foreground">
                            {`Updated ${formatDistance(
                              new Date(document.createdAt),
                              new Date(),
                              { addSuffix: true }
                            )}`}
                          </div>
                        ) : (
                          <div className="w-32 h-3 mt-2 bg-muted-foreground/20 rounded-md animate-pulse" />
                        )}
                      </div>
                    </div>
                    <BlockActions
                      block={block}
                      currentVersionIndex={currentVersionIndex}
                      handleVersionChange={handleVersionChange}
                      isCurrentVersion={isCurrentVersion}
                      mode={mode}
                      setConsoleOutputs={setConsoleOutputs}
                    />
                  </div>

                  <div
                    className={cn(
                      "flex-grow dark:bg-muted bg-background h-full overflow-y-auto !max-w-full pb-40",
                      {
                        "py-2 px-2": block.kind === "code",
                        "py-8 md:p-20 px-4": block.kind === "text",
                        "w-full": block.kind === "spreadsheet",
                      }
                    )}
                  >
                    <div
                      className={cn("flex flex-row", {
                        "w-full":
                          block.kind === "code" || block.kind === "spreadsheet",
                        "mx-auto max-w-[600px]": block.kind === "text",
                      })}
                    >
                      {isDocumentsFetching && !block.content ? (
                        <DocumentSkeleton />
                      ) : block.kind === "code" ? (
                        <div className="size-full">
                          <CodeEditor
                            content={
                              isCurrentVersion
                                ? block.content
                                : getDocumentContentById(currentVersionIndex)
                            }
                            isCurrentVersion={isCurrentVersion}
                            currentVersionIndex={currentVersionIndex}
                            suggestions={suggestions ?? []}
                            status={block.status}
                            saveContent={saveContent}
                          />
                        </div>
                      ) : block.kind === "text" ? (
                        mode === "edit" ? (
                          <Editor
                            content={
                              isCurrentVersion
                                ? block.content
                                : getDocumentContentById(currentVersionIndex)
                            }
                            isCurrentVersion={isCurrentVersion}
                            currentVersionIndex={currentVersionIndex}
                            status={block.status}
                            saveContent={saveContent}
                            suggestions={
                              isCurrentVersion ? suggestions ?? [] : []
                            }
                          />
                        ) : (
                          <DiffView
                            oldContent={getDocumentContentById(
                              currentVersionIndex - 1
                            )}
                            newContent={getDocumentContentById(
                              currentVersionIndex
                            )}
                          />
                        )
                      ) : block.kind === "spreadsheet" ? (
                        <div className="size-full">
                          <SpreadsheetEditor
                            content={
                              isCurrentVersion
                                ? block.content
                                : getDocumentContentById(currentVersionIndex)
                            }
                            isCurrentVersion={isCurrentVersion}
                            currentVersionIndex={currentVersionIndex}
                            status={block.status}
                            saveContent={saveContent}
                          />
                        </div>
                      ) : null}

                      <AnimatePresence>
                        {isCurrentVersion && (
                          <Toolbar
                            isToolbarVisible={isToolbarVisible}
                            setIsToolbarVisible={setIsToolbarVisible}
                            append={append}
                            isLoading={isLoading}
                            stop={stop}
                            setMessages={setMessages}
                            blockKind={block.kind}
                          />
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <AnimatePresence>
                    {!isCurrentVersion && (
                      <VersionFooter
                        currentVersionIndex={currentVersionIndex}
                        documents={documents}
                        handleVersionChange={handleVersionChange}
                      />
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    <Console
                      consoleOutputs={consoleOutputs}
                      setConsoleOutputs={setConsoleOutputs}
                    />
                  </AnimatePresence>
                </motion.div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Block = memo(PureBlock, (prevProps, nextProps) => {
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.input !== nextProps.input) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;

  return true;
});
