import type { Message } from "ai";
import type { ChatRequestOptions } from "@/lib/types";
import { PreviewMessage } from "./message";
import { useScrollToBottom } from "./use-scroll-to-bottom";
import { memo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MessagesProps {
  chatId: string;
  isLoading: boolean;
  messages: Message[];
  setMessages: (
    messages: Message[] | ((messages: Message[]) => Message[])
  ) => void;
  reload: (
    chatRequestOptions?: ChatRequestOptions
  ) => Promise<string | null | undefined>;
}

function PureMessages({
  chatId,
  isLoading,
  messages,
  setMessages,
  reload,
}: MessagesProps) {
  const [messagesContainerRef, messagesEndRef] =
    useScrollToBottom<HTMLDivElement>();

  // Handle rate limit error
  const handleError = async (error: any) => {
    if (error?.response?.status === 429) {
      const data = await error.response.json();
      const resetInSeconds = Math.ceil((data.reset - Date.now()) / 1000);
      toast.error(
        `Rate limit exceeded. Please wait ${resetInSeconds} seconds before trying again.`,
        {
          duration: Math.min(resetInSeconds * 1000, 5000),
        }
      );
    }
  };

  return (
    <div
      ref={messagesContainerRef}
      className={cn("relative mx-auto max-w-3xl pt-4 flex flex-col gap-2")}
    >
      {messages.map((message, index) => (
        <PreviewMessage
          key={message.id}
          chatId={chatId}
          message={message}
          isLoading={isLoading && messages.length - 1 === index}
          setMessages={setMessages}
          reload={async (options?: ChatRequestOptions) => {
            try {
              return await reload(options);
            } catch (error) {
              handleError(error);
              return null;
            }
          }}
        />
      ))}

      {/* {isLoading && <ThinkingMessage />} */}

      <div
        ref={messagesEndRef}
        className="shrink-0 min-w-[24px] min-h-[36px]"
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.isLoading && nextProps.isLoading) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;

  return true;
});
