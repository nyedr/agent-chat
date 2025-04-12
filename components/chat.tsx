"use client";

import type { Attachment, Message } from "ai";
import { useChat } from "@ai-sdk/react";
import { Dispatch, SetStateAction, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { useLocalStorage } from "usehooks-ts";

import { ChatHeader } from "@/components/chat-header";

import { MultimodalInput, SearchMode } from "./multimodal-input";
import { Messages } from "./messages";
import { useChatContext } from "@/lib/chat/chat-context";
import { generateUUID } from "@/lib/utils";
import { LLMSettings } from "./settings-dialog";
import { DeepResearch } from "./deep-research";
import { useDeepResearch } from "@/lib/deep-research-context";
import { Artifact } from "./artifact";
import { Greeting } from "./greeting";

const SETTINGS_STORAGE_KEY = "llmSettings";

export function Chat({
  id,
  initialMessages,
  selectedModelId,
}: {
  id: string;
  initialMessages: Array<Message>;
  selectedModelId: string;
}) {
  const { notifyChatUpdated } = useChatContext();
  const { mutate } = useSWRConfig();
  const [searchMode, setSearchMode] = useState<SearchMode>("agent");
  const [settings, setSettings] = useLocalStorage<LLMSettings>(
    SETTINGS_STORAGE_KEY,
    {}
  );

  const handleSettingsChange = (newSettings: LLMSettings) => {
    setSettings(newSettings);
  };

  const {
    messages,
    setMessages,
    handleSubmit,
    input,
    setInput,
    append,
    stop,
    reload,
    status,
  } = useChat({
    id,
    body: {
      chatId: id,
      modelId: selectedModelId,
      experimental_deepResearch: searchMode === "deep-research",
      ...settings,
    },
    sendExtraMessageFields: true,
    generateId: generateUUID,
    initialMessages,
    // experimental_throttle: 100,
    onFinish: (message) => {
      console.log("message generated:", message);
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

  const { state: deepResearchState } = useDeepResearch();

  const isLoading = status === "submitted" || status === "streaming";

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  const handleSearchModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
  };

  const messagesAsMessage = messages as Message[];
  const setMessagesAsMessage = setMessages as Dispatch<
    SetStateAction<Message[]>
  >;

  return (
    <>
      <div className="flex relative flex-col min-w-0 h-dvh bg-background">
        <ChatHeader
          selectedModelId={selectedModelId}
          settings={settings}
          onSettingsChange={handleSettingsChange}
        />

        {messages.length === 0 && <Greeting />}

        <div className="flex-1 overflow-y-auto md:px-5 px-2 pb-2 sm:pb-4">
          <Messages
            chatId={id}
            isLoading={isLoading}
            messages={messages as Message[]}
            setMessages={setMessages as Dispatch<SetStateAction<Message[]>>}
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
            messages={messagesAsMessage}
            setMessages={setMessagesAsMessage}
            append={append}
            searchMode={searchMode}
            setSearchMode={handleSearchModeChange}
          />
        </div>
      </div>

      {deepResearchState.isResearchInfoOpen && (
        <DeepResearch
          isActive={searchMode === "deep-research"}
          activity={deepResearchState.activity}
          sources={deepResearchState.sources}
        />
      )}

      <Artifact
        chatId={id}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        stop={stop}
        attachments={attachments}
        setAttachments={setAttachments}
        append={append}
        messages={messagesAsMessage}
        setMessages={setMessagesAsMessage}
        reload={reload}
        isReadonly={false}
        status={status}
      />
    </>
  );
}
