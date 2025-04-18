"use client";

import { ChatRequestOptions, Message } from "ai";
import { Button } from "./ui/button";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { Textarea } from "./ui/textarea";
import {
  deleteTrailingMessages,
  updateMessageContent,
} from "@/app/(chat)/actions";
import { cn } from "@/lib/utils";

export type MessageEditorProps = {
  message: Message;
  setMode: Dispatch<SetStateAction<"view" | "edit">>;
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
  chatId: string;
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
  reload,
  chatId,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${
        textareaRef.current.scrollHeight + 2
      }px`;
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  const isUserMessage = message.role === "user";

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        ref={textareaRef}
        className="bg-muted outline-none border-none rounded-xl resize-none max-h-[200px] overflow-y-auto w-full"
        value={draftContent}
        onChange={handleInput}
      />

      <div
        className={cn("flex flex-row gap-2", {
          "justify-end": isUserMessage,
          "justify-start": !isUserMessage,
        })}
      >
        <Button
          variant="outline"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode("view");
          }}
        >
          Cancel
        </Button>
        <Button
          variant="default"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);
            // For assistant messages, update the content and save to the database
            if (!chatId) {
              throw new Error("Chat ID not found");
            }

            try {
              if (message.role === "user") {
                await deleteTrailingMessages({
                  id: chatId,
                  messageId: message.id,
                });

                setMessages((messages) => {
                  const index = messages.findIndex((m) => m.id === message.id);

                  if (index !== -1) {
                    const updatedMessage = {
                      ...message,
                      content: draftContent,
                    };

                    return [...messages.slice(0, index), updatedMessage];
                  }

                  return messages;
                });

                await reload();
              } else {
                setMessages((messages) => {
                  if (!messages) return [];

                  const editedMessageIndex = messages.findIndex(
                    (m) => m.id === message.id
                  );

                  if (editedMessageIndex === -1) {
                    return messages;
                  }

                  const editedMessage = {
                    ...messages[editedMessageIndex],
                    content: draftContent,
                    parts: messages[editedMessageIndex].parts?.map((part) => {
                      if (part.type === "text") {
                        return { ...part, text: draftContent };
                      }
                      return part;
                    }),
                  };

                  return [
                    ...messages.slice(0, editedMessageIndex),
                    editedMessage,
                    ...messages.slice(editedMessageIndex + 1),
                  ];
                });

                // Then persist to the database
                const result = await updateMessageContent(
                  chatId.toString(),
                  message.id,
                  draftContent
                );

                if (!result.success) {
                  throw new Error("Failed to save message changes to database");
                }

                console.log("Successfully updated message in database");
              }
            } catch (error) {
              console.error("Error while editing message:", error);
            } finally {
              setIsSubmitting(false);
              setMode("view");
            }
          }}
        >
          {isSubmitting ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
