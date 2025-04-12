"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo, useCallback, Dispatch, SetStateAction } from "react";
import CopyButton from "./ui/copy-button";
import DeleteButton from "./ui/delete-button";
import RetryButton from "./ui/retry-button";
import ContinueButton from "./ui/continue-button";
import { cn } from "@/lib/utils";
import EditMessageButton from "./ui/edit-message-button";
import { ChatRequestOptions, Message } from "ai";

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  reload,
  continue: continueMessage,
  scrollToMessage,
  setMode,
  deleteMessage,
}: {
  chatId: string;
  message: Message;
  isLoading: boolean;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  continue?: (messageId: string) => Promise<string | null | undefined>;
  scrollToMessage?: (messageId: string) => void;
  setMode: Dispatch<SetStateAction<"edit" | "view">>;
  deleteMessage: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
}) {
  const handleContinue = useCallback(async () => {
    if (continueMessage) {
      try {
        await continueMessage(message.id);
      } catch (error) {
        console.error("Error continuing message:", error);
        // You could add toast notification here if desired
      }
    } else {
      console.warn("Continue function not provided");
    }
  }, [message.id, continueMessage]);

  if (isLoading) return null;

  const isUserMessage = message.role === "user";

  return (
    <div
      className={cn(
        "flex flex-row gap-1 items-center invisible group-hover:visible",
        {
          "justify-end": isUserMessage,
          "justify-start": !isUserMessage,
        }
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <CopyButton content={message.content} asChild={false} />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Copy
        </TooltipContent>
      </Tooltip>

      {!isUserMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <RetryButton reload={reload} asChild={false} />
          </TooltipTrigger>
          <TooltipContent align="center" side="bottom">
            Retry
          </TooltipContent>
        </Tooltip>
      )}

      {!isUserMessage && (
        <Tooltip>
          <TooltipTrigger asChild>
            <ContinueButton
              continue={handleContinue}
              chatId={chatId}
              messageId={message.id}
              scrollToMessage={scrollToMessage}
              asChild={false}
            />
          </TooltipTrigger>
          <TooltipContent align="center" side="bottom">
            Continue
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <EditMessageButton
            content={message.content}
            asChild={false}
            setMode={setMode}
          />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Edit message
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <DeleteButton
            chatId={chatId}
            messageId={message.id}
            asChild={false}
            onDelete={deleteMessage}
          />
        </TooltipTrigger>
        <TooltipContent align="center" side="bottom">
          Delete
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;

    // Check critical props that would require re-rendering
    if (prevProps.setMode !== nextProps.setMode) return false;
    if (prevProps.reload !== nextProps.reload) return false;
    if (prevProps.continue !== nextProps.continue) return false;
    if (prevProps.scrollToMessage !== nextProps.scrollToMessage) return false;
    if (prevProps.chatId !== nextProps.chatId) return false;

    // Message comparison (checking ID is usually sufficient for messages)
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;

    return true;
  }
);
