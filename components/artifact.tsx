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
import useSWR, { useSWRConfig } from "swr";
import { useDebounceCallback, useWindowSize } from "usehooks-ts";
import type { Document } from "@/lib/db/schema";
import { fetcher, cn } from "@/lib/utils";
import { MultimodalInput } from "./multimodal-input";
import { Toolbar } from "./toolbar";
import { VersionFooter } from "./version-footer";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactCloseButton } from "./artifact-close-button";
import { ArtifactMessages } from "./artifact-messages";
import { useSidebar } from "./ui/sidebar";
import { useArtifact } from "@/hooks/use-artifact";
import { imageArtifact } from "@/artifacts/image/client";
import { codeArtifact } from "@/artifacts/code/client";
import { sheetArtifact } from "@/artifacts/sheet/client";
import { textArtifact } from "@/artifacts/text/client";
import { htmlArtifact } from "@/artifacts/html/client";
import equal from "fast-deep-equal";
import { UseChatHelpers } from "@ai-sdk/react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

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
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

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
  isReadonly,
}: {
  chatId: string;
  input: string;
  setInput: UseChatHelpers["setInput"];
  status: UseChatHelpers["status"];
  stop: UseChatHelpers["stop"];
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<Message>;
  setMessages: Dispatch<SetStateAction<Array<Message>>>;
  append: UseChatHelpers["append"];
  handleSubmit: UseChatHelpers["handleSubmit"];
  reload: UseChatHelpers["reload"];
  isReadonly: boolean;
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();

  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments,
  } = useSWR<Array<Document>>(
    artifact.documentId !== "init" && artifact.status !== "streaming"
      ? `/api/document?id=${artifact.documentId}`
      : null,
    fetcher
  );

  const [mode, setMode] = useState<"edit" | "diff">("edit");
  const [document, setDocument] = useState<Document | null>(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);

  const { open: isSidebarOpen } = useSidebar();

  useEffect(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);

      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);

        // Preserve existing content unless it's empty or a placeholder
        const isPlaceholder =
          artifact.content?.includes("document was created") ||
          !artifact.content;

        setArtifact((currentArtifact) => ({
          ...currentArtifact,
          content:
            isPlaceholder && mostRecentDocument.content
              ? mostRecentDocument.content
              : currentArtifact.content || mostRecentDocument.content || "",
        }));
      }
    }
  }, [documents, setArtifact, artifact.content]);

  useEffect(() => {
    mutateDocuments();
  }, [artifact.status, mutateDocuments]);

  const { mutate } = useSWRConfig();
  const [isContentDirty, setIsContentDirty] = useState(false);

  const handleContentChange = useCallback(
    (updatedContent: string) => {
      if (!artifact) return;

      mutate<Array<Document>>(
        `/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) return undefined;

          const currentDocument = currentDocuments.at(-1);

          if (!currentDocument || !currentDocument.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }

          if (currentDocument.content !== updatedContent) {
            await fetch(`/api/document?id=${artifact.documentId}`, {
              method: "POST",
              body: JSON.stringify({
                title: artifact.title,
                content: updatedContent,
                kind: artifact.kind,
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
    [artifact, mutate]
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

  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );

  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }

  useEffect(() => {
    if (artifact.documentId !== "init") {
      if (artifactDefinition.initialize) {
        artifactDefinition.initialize({
          documentId: artifact.documentId,
          setMetadata,
        });
      }
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);

  return (
    <AnimatePresence>
      {artifact.isVisible && (
        <motion.div
          data-testid="artifact"
          className="flex flex-row h-dvh w-dvw fixed top-0 left-0 z-50 bg-transparent"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0 } }}
        >
          {!isMobile && (
            <motion.div
              className="fixed bg-background h-dvh"
              initial={{
                width: isSidebarOpen ? windowWidth - 256 : windowWidth,
                right: 0,
              }}
              animate={{ width: windowWidth, right: 0 }}
              exit={{
                width: isSidebarOpen ? windowWidth - 256 : windowWidth,
                right: 0,
              }}
            />
          )}

          {!isMobile && (
            <ResizablePanelGroup direction="horizontal" className="h-dvh w-dvw">
              <ResizablePanel defaultSize={50} minSize={20} maxSize={50}>
                <div className="relative bg-muted dark:bg-background h-dvh flex flex-col justify-between items-center gap-4 border-r">
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

                  <ArtifactMessages
                    chatId={chatId}
                    isLoading={status === "streaming"}
                    messages={messages}
                    setMessages={setMessages}
                    reload={reload}
                    artifactStatus={artifact.status}
                  />

                  <div className="flex flex-row gap-2 relative items-end w-full p-4 border-t">
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
                      className="bg-background dark:bg-muted"
                      setMessages={setMessages}
                    />
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={50} minSize={30}>
                <motion.div
                  className="dark:bg-muted bg-background h-dvh flex flex-col overflow-hidden"
                  exit={{
                    opacity: 0,
                    scale: 0.95,
                    transition: {
                      delay: 0.1,
                      duration: 0.2,
                    },
                  }}
                >
                  <div className="p-2 flex flex-row justify-between items-start sticky top-0 bg-background/80 dark:bg-muted/80 backdrop-blur-sm z-10 border-b shrink-0">
                    <div className="flex flex-row gap-4 items-start">
                      <ArtifactCloseButton />
                      <div className="flex flex-col">
                        <div className="font-medium">{artifact.title}</div>
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
                    <ArtifactActions
                      artifact={artifact}
                      currentVersionIndex={currentVersionIndex}
                      handleVersionChange={handleVersionChange}
                      isCurrentVersion={isCurrentVersion}
                      mode={mode}
                      metadata={metadata}
                      setMetadata={setMetadata}
                    />
                  </div>

                  <div className="dark:bg-muted bg-background grow h-full overflow-y-auto !max-w-full items-center relative">
                    <div
                      className={cn("h-full", {
                        "p-4 py-8 md:p-20": artifact.kind === "text",
                        "p-2":
                          artifact.kind === "code" || artifact.kind === "sheet",
                        "flex items-center justify-center p-4":
                          artifact.kind === "image",
                      })}
                    >
                      <div
                        className={cn("h-full w-full", {
                          "mx-auto max-w-3xl": artifact.kind === "text",
                        })}
                      >
                        <artifactDefinition.content
                          title={artifact.title}
                          content={
                            isCurrentVersion
                              ? artifact.content
                              : getDocumentContentById(currentVersionIndex)
                          }
                          mode={mode}
                          status={artifact.status}
                          currentVersionIndex={currentVersionIndex}
                          suggestions={[]}
                          onSaveContent={saveContent}
                          isInline={false}
                          isCurrentVersion={isCurrentVersion}
                          getDocumentContentById={getDocumentContentById}
                          isLoading={isDocumentsFetching && !artifact.content}
                          metadata={metadata}
                          setMetadata={setMetadata}
                        />
                      </div>
                    </div>
                    <AnimatePresence>
                      {isCurrentVersion && (
                        <Toolbar
                          isToolbarVisible={isToolbarVisible}
                          setIsToolbarVisible={setIsToolbarVisible}
                          append={append}
                          isLoading={status === "streaming"}
                          stop={stop}
                          setMessages={setMessages}
                          artifactKind={artifact.kind}
                        />
                      )}
                    </AnimatePresence>
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
                </motion.div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Artifact = memo(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.input !== nextProps.input) return false;
  if (!equal(prevProps.messages.length, nextProps.messages.length))
    return false;
  if (!equal(prevProps.attachments, nextProps.attachments)) return false;

  return true;
});
