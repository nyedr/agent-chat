"use client";

import type { Attachment, CreateMessage, Message } from "ai";
import type { ChatRequestOptions } from "@/lib/types";
import type React from "react";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";

import { cn, sanitizeUIMessages } from "@/lib/utils";

import { ArrowUpIcon, PaperclipIcon, RobotIcon, StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { SuggestedActions } from "./suggested-actions";
import equal from "fast-deep-equal";
import { useDeepResearch } from "@/lib/deep-research-context";
import { DeepResearch } from "./deep-research";
import { Telescope, Search } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export type SearchMode = "agent" | "deep-research";

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  isLoading,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  append,
  handleSubmit,
  className,
  searchMode,
  setSearchMode,
}: {
  chatId: string;
  input: string;
  setInput: (value: string) => void;
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
  className?: string;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const { state: deepResearchState } = useDeepResearch();

  const adjustHeight = () => {
    if (textareaRef.current) {
      // Store the current scroll position
      const scrollTop = textareaRef.current.scrollTop;

      // Reset height to calculate the actual scrollHeight correctly
      textareaRef.current.style.height = "auto";

      // Get the scrollHeight (content height)
      const scrollHeight = textareaRef.current.scrollHeight;

      // Get the maximum height from CSS (75vh converted to pixels)
      const maxHeight = window.innerHeight * 0.75;

      // Use the lower of scrollHeight or maxHeight for the textarea height
      const newHeight = Math.min(scrollHeight + 2, maxHeight);
      textareaRef.current.style.height = `${newHeight}px`;

      // Restore the scroll position
      textareaRef.current.scrollTop = scrollTop;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = "44px";
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  // Adjust height when window resizes
  useEffect(() => {
    if (width) {
      adjustHeight();
    }
  }, [width]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Preserve the current cursor position before adjusting
    const selectionStart = event.target.selectionStart;
    const selectionEnd = event.target.selectionEnd;

    const newValue = event.target.value;
    setInput(newValue);
    adjustHeight();

    // After React updates the component and adjusts height,
    // restore the cursor position
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = selectionStart;
        textareaRef.current.selectionEnd = selectionEnd;
      }
    });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);

  const submitForm = useCallback(() => {
    window.history.replaceState({}, "", `/chat/${chatId}`);

    handleSubmit(undefined, {
      experimental_attachments: attachments,
      experimental_deepResearch: searchMode === "deep-research",
    });

    setAttachments([]);
    setLocalStorageInput("");
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    attachments,
    handleSubmit,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    searchMode,
  ]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType: contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (error) {
      toast.error("Failed to upload file, please try again!");
    }
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments]
  );

  return (
    <div className="mx-auto text-base px-3 w-full md:px-5 lg:px-4 xl:px-5">
      <div className="mx-auto flex flex-1 text-base gap-4 md:gap-5 lg:gap-6 md:max-w-3xl">
        {/* This div is for alignment with other elements in the chat UI */}
        <div className="flex justify-center empty:hidden"></div>

        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isLoading) {
              submitForm();
            }
          }}
        >
          <div className="relative flex h-full max-w-full flex-1 flex-col gap-3">
            {messages.length === 0 &&
              attachments.length === 0 &&
              uploadQueue.length === 0 && (
                <SuggestedActions append={append} chatId={chatId} />
              )}

            <div className="absolute bottom-full inset-x-0 z-20">
              {/* Attachments preview area */}
              {(attachments.length > 0 || uploadQueue.length > 0) && (
                <div className="flex flex-row gap-2 overflow-x-auto items-end mb-2">
                  {attachments.map((attachment) => (
                    <PreviewAttachment
                      key={attachment.url}
                      attachment={attachment}
                    />
                  ))}

                  {uploadQueue.map((filename) => (
                    <PreviewAttachment
                      key={filename}
                      attachment={{
                        url: "",
                        name: filename,
                        contentType: "",
                      }}
                      isUploading={true}
                    />
                  ))}
                </div>
              )}
            </div>

            {searchMode === "deep-research" && (
              <DeepResearch
                isActive={searchMode === "deep-research"}
                onToggle={() => {}}
                isLoading={isLoading}
                activity={deepResearchState.activity}
                sources={deepResearchState.sources}
                deepResearch={searchMode === "deep-research"}
              />
            )}

            <div className="group relative flex w-full items-center">
              <div className="w-full">
                <div
                  id="composer-background"
                  className="flex w-full cursor-text min-h-[116px] justify-between flex-col rounded-3xl border px-3 py-1 duration-150 ease-in-out shadow-[0_2px_12px_0px_rgba(0,0,0,0.04),_0_9px_9px_0px_rgba(0,0,0,0.01),_0_2px_5px_0px_rgba(0,0,0,0.06)] bg-background dark:bg-[#303030] dark:border-none dark:shadow-none has-[:focus]:shadow-[0_2px_12px_0px_rgba(0,0,0,0.04),_0_9px_9px_0px_rgba(0,0,0,0.01),_0_2px_5px_0px_rgba(0,0,0,0.06)]"
                  onClick={(event) => {
                    // Check if the clicked element is not a button
                    const target = event.target as HTMLElement;
                    const isButton =
                      target.tagName === "BUTTON" ||
                      target.closest("button") !== null;

                    // Only focus the textarea if we're not clicking on a button
                    if (!isButton && textareaRef.current) {
                      textareaRef.current.focus();
                    }
                  }}
                >
                  <div className="flex flex-col justify-start">
                    <div className="flex min-h-[44px] items-start pl-1">
                      <div className="min-w-0 max-w-full flex-1">
                        <Textarea
                          ref={textareaRef}
                          placeholder="Ask anything..."
                          value={input}
                          onChange={handleInput}
                          className={cn(
                            " min-h-[24px] max-h-[calc(75dvh)] overflow-y-auto resize-none !border-0 !shadow-none !bg-transparent !p-0 !py-2 !rounded-none !text-base",
                            className
                          )}
                          rows={1}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();

                              if (isLoading) {
                                toast.error(
                                  "Please wait for the model to finish its response!"
                                );
                              } else {
                                submitForm();
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mb-2 mt-1 flex items-center justify-between sm:mt-2">
                    <div className="flex gap-x-1.5">
                      <input
                        type="file"
                        className="hidden"
                        ref={fileInputRef}
                        multiple
                        onChange={handleFileChange}
                        tabIndex={-1}
                      />
                      <Button
                        className="max-w-10 rounded-full dark:bg-muted bg-background hover:bg-accent dark:hover:bg-accent"
                        onClick={(event) => {
                          event.preventDefault();
                          fileInputRef.current?.click();
                        }}
                        disabled={isLoading}
                        variant="outline"
                      >
                        <PaperclipIcon className="size-5" />
                      </Button>

                      <Tabs
                        value={searchMode}
                        onValueChange={(value) => {
                          setSearchMode(value as SearchMode);
                        }}
                      >
                        <TabsList className="bg-transparent text-muted-foreground border rounded-full p-1 h-fit">
                          <TabsTrigger
                            value="agent"
                            className="rounded-full px-3 py-1.5 h-fit flex items-center gap-2 data-[state=inactive]:bg-transparent data-[state=active]:bg-primary/10 hover:bg-primary/5 data-[state=active]:text-primary border-0 data-[state=active]:shadow-none transition-colors"
                          >
                            <RobotIcon className="size-5" />
                            Agent
                          </TabsTrigger>
                          <TabsTrigger
                            value="deep-research"
                            className="rounded-full px-3 py-1.5 h-fit flex items-center gap-2 data-[state=inactive]:bg-transparent data-[state=active]:bg-primary/10 hover:bg-primary/5 data-[state=active]:text-primary border-0 data-[state=active]:shadow-none transition-colors"
                          >
                            <Telescope className="size-5" />
                            Deep Research
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>

                    <div className="flex gap-x-1.5">
                      {isLoading ? (
                        <Button
                          className="flex size-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-token-text-secondary hover:bg-muted dark:hover:bg-zinc-700"
                          onClick={(event) => {
                            event.preventDefault();
                            stop();
                            setMessages((messages) =>
                              sanitizeUIMessages(messages)
                            );
                          }}
                          variant="ghost"
                        >
                          <StopIcon size={14} />
                        </Button>
                      ) : (
                        <Button
                          className="flex size-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none disabled:text-[#f4f4f4] disabled:hover:opacity-100 dark:focus-visible:outline-white bg-black text-white dark:bg-white dark:text-black hover:opacity-70 disabled:bg-[#D7D7D7]"
                          onClick={(event) => {
                            event.preventDefault();
                            submitForm();
                          }}
                          disabled={
                            input.length === 0 || uploadQueue.length > 0
                          }
                        >
                          <ArrowUpIcon size={18} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;
    if (prevProps.searchMode !== nextProps.searchMode) return false;
    return true;
  }
);
