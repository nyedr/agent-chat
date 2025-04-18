"use client";

import type { ChatRequestOptions, Message } from "ai";
import cx from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useState, useEffect, useCallback } from "react";

import Markdown from "./markdown";
import { MessageActions } from "./message-actions";
import { PreviewAttachment } from "./preview-attachment";
import equal from "fast-deep-equal";
import { cn, extractSearchSources } from "@/lib/utils";
import { MessageEditor } from "./message-editor";
import { useDeepResearch } from "@/lib/deep-research-context";
import AnimatedGradientText from "./ui/gradient-text";
import { deleteSingleMessage } from "@/app/(chat)/actions";
import Image from "next/image";
import { ToolResultRenderer } from "./tool-result-renderer";
import { MessageReasoning } from "./message-reasoning";

const UserMessage = ({ message }: { message: Message }) => (
  <div className="markdown-message-container flex flex-col gap-4 max-w-[736px] rounded-3xl px-5 py-2.5 bg-muted text-primary-foreground w-fit align-end">
    <Markdown isUserMessage={true} content={message.content} />
  </div>
);

const MessageAttachments = ({
  attachments,
}: {
  attachments?: { url: string }[];
}) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-row justify-end gap-2">
      {attachments.map((attachment) => (
        <PreviewAttachment key={attachment.url} attachment={attachment} />
      ))}
    </div>
  );
};

const MessagePartsComponent = ({
  parts,
  chatId,
  isLoading,
  messageId,
}: {
  parts?: any[];
  chatId: string;
  isLoading: boolean;
  messageId: string;
}) => {
  if (!parts || parts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 w-full">
      {parts.map((part, index) => {
        const key = `message-${messageId}-part-${index}`;

        if (part.type === "reasoning") {
          return (
            <MessageReasoning
              key={key}
              reasoning={part.reasoning}
              isLoading={isLoading}
            />
          );
        }

        if (part.type === "text") {
          return (
            <div
              key={`text-${index}`}
              className="markdown-message-container flex flex-col max-w-[736px] w-full gap-2 prose prose-sm dark:prose-invert"
            >
              <Markdown isUserMessage={false} content={part.text} />
            </div>
          );
        }

        if (part.type === "tool-invocation") {
          const { toolInvocation } = part;
          const { toolName, toolCallId, state, args } = toolInvocation;

          return (
            <div
              key={`tool-${toolCallId}`}
              className={cx({
                skeleton: ["getWeather"].includes(toolName),
              })}
            >
              <ToolResultRenderer
                toolName={toolName}
                state={state}
                args={args}
                result={state === "result" ? toolInvocation.result : undefined}
                isLoading={state !== "result"}
                chatId={chatId}
              />
            </div>
          );
        }

        if (part.type === "file") {
          return (
            <div key={`file-${index}`} className="file-container">
              <Image
                src={`data:${part.mimeType};base64,${part.data}`}
                className="max-w-full max-h-[400px] rounded-md"
                alt="File"
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

// Memoize MessageParts
const MessageParts = memo(MessagePartsComponent);

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  setMessages,
  reload,
}: {
  chatId: string;
  message: Message;
  isLoading: boolean;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const { addSource } = useDeepResearch();

  const deleteMessage = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();

      try {
        await deleteSingleMessage({
          id: chatId,
          messageId: message.id,
        });

        setMessages((currentMessages) => {
          return currentMessages?.filter((msg) => msg.id !== message.id) || [];
        });
      } catch (error) {
        console.error("Error deleting message:", error);
      }
    },
    [message.id, setMessages, chatId]
  );

  // Track sources from search results (this seems specific to standard search, keep for now)
  const [searchSources, setSearchSources] = useState<
    Array<{
      title: string;
      url: string;
      description: string;
      source: string;
      relevance: number;
    }>
  >([]);

  useEffect(() => {
    const sources = extractSearchSources(message.parts);
    setSearchSources(sources);
    sources.forEach((source) => addSource(source));
  }, [message.parts, addSource]);

  return (
    <AnimatePresence>
      <motion.div
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            "flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
            {
              "w-full": mode === "edit",
              "group-data-[role=user]/message:w-fit": mode !== "edit",
            }
          )}
        >
          <div
            className={cn("group flex flex-col gap-2 w-full", {
              "items-end": message.role === "user",
              "items-start": message.role === "assistant",
            })}
          >
            <MessageAttachments
              attachments={message.experimental_attachments}
            />

            {message.content && mode === "view" && message.role === "user" && (
              <UserMessage message={message} />
            )}

            {message.content && mode === "edit" && (
              <div className="flex w-full flex-row gap-2 items-start">
                <MessageEditor
                  key={message.id}
                  message={message}
                  setMode={setMode}
                  setMessages={setMessages}
                  reload={reload}
                  chatId={chatId}
                />
              </div>
            )}

            {message.role !== "user" &&
              message.parts &&
              message.parts.length > 0 && (
                <MessageParts
                  chatId={chatId}
                  parts={message.parts}
                  isLoading={isLoading}
                  messageId={message.id}
                />
              )}

            {(message.role === "assistant" || message.role === "user") && (
              <MessageActions
                key={`action-${message.id}`}
                chatId={chatId}
                message={message}
                isLoading={isLoading}
                reload={reload}
                setMode={setMode}
                deleteMessage={deleteMessage}
              />
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;

    return true;
  }
);

export const ThinkingMessage = () => (
  <motion.div
    className="w-full mx-auto max-w-3xl px-4 group/message "
    initial={{ y: 5, opacity: 0 }}
    animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
    data-role="assistant"
  >
    <AnimatedGradientText className="text-base" text="Thinking..." />
  </motion.div>
);
