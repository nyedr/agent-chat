"use client";

import type { Attachment, Message } from "ai";
import { useChat } from "ai/react";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";

import { ChatHeader } from "@/components/chat-header";

import { Block } from "./block";
import { MultimodalInput, SearchMode } from "./multimodal-input";
import { Messages } from "./messages";
import { useChatContext } from "@/lib/chat/chat-context";

export function Chat({
  id,
  initialMessages,
  selectedModelId,
  selectedReasoningModelId,
}: {
  id: string;
  initialMessages: Array<Message>;
  selectedModelId: string;
  selectedReasoningModelId: string;
}) {
  const { notifyChatUpdated } = useChatContext();
  const { mutate } = useSWRConfig();
  const [searchMode, setSearchMode] = useState<SearchMode>("agent");

  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    isLoading,
    stop,
    reload,
  } = useChat({
    id,
    body: {
      id,
      modelId: selectedModelId,
      reasoningModelId: selectedReasoningModelId,
      experimental_deepResearch: searchMode === "deep-research",
    },
    initialMessages,
    experimental_throttle: 100,
    onFinish: () => {
      notifyChatUpdated(id);
      mutate("/api/history");
    },
    onError: async (error: Error) => {
      if (error.message.includes("Too many requests")) {
        toast.error(
          "Too many requests. Please wait a few seconds before sending another message."
        );
      } else {
        toast.error(`Error: ${error.message || "An unknown error occurred"}`);

        if (error instanceof Response || "status" in error) {
          try {
            const errorData = await (error as Response).json();
            console.error("Response error details:", errorData);
          } catch (e) {
            console.error("Could not parse error response:", e);
          }
        }
      }
    },
  });

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
  };

  return (
    <>
      <div className="flex relative flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          selectedModelId={selectedModelId}
          selectedReasoningModelId={selectedReasoningModelId}
        />
        <div className="flex-1 overflow-y-auto md:px-5 px-2">
          <Messages
            chatId={id}
            isLoading={isLoading}
            messages={messages}
            setMessages={setMessages}
            reload={reload}
          />
        </div>

        <div className="sticky bottom-2 md:bottom-8 inset-x-0 bg-transparent">
          <MultimodalInput
            chatId={id}
            input={input}
            setInput={setInput}
            handleSubmit={handleSubmit}
            isLoading={isLoading}
            stop={stop}
            attachments={attachments}
            setAttachments={setAttachments}
            messages={messages}
            setMessages={setMessages}
            append={append}
            searchMode={searchMode}
            setSearchMode={handleSearchModeChange}
          />
        </div>
      </div>

      <Block
        chatId={id}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        isLoading={isLoading}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messages}
        setMessages={setMessages}
        reload={reload}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
      />
    </>
  );
}
