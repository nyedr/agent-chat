"use client";

import { createContext, useContext, ReactNode, useCallback } from "react";
import { mutate } from "swr";

interface ChatContextType {
  refreshHistory: () => void;
  notifyNewChat: (chatId: string) => void;
  notifyChatUpdated: (chatId: string) => void;
  notifyChatDeleted: (chatId: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  // Function to refresh all chat-related SWR keys
  const refreshHistory = useCallback(() => {
    // Refresh all chat-related endpoints
    mutate("/api/chat");
    mutate("/api/history");
    mutate("/api/folders");
  }, []);

  // Function to notify when a new chat is created
  const notifyNewChat = useCallback(
    (chatId: string) => {
      console.log(`New chat created: ${chatId}`);
      refreshHistory();
    },
    [refreshHistory]
  );

  // Function to notify when a chat is updated
  const notifyChatUpdated = useCallback(
    (chatId: string) => {
      console.log(`Chat updated: ${chatId}`);
      refreshHistory();
    },
    [refreshHistory]
  );

  // Function to notify when a chat is deleted
  const notifyChatDeleted = useCallback(
    (chatId: string) => {
      console.log(`Chat deleted: ${chatId}`);
      refreshHistory();
    },
    [refreshHistory]
  );

  return (
    <ChatContext.Provider
      value={{
        refreshHistory,
        notifyNewChat,
        notifyChatUpdated,
        notifyChatDeleted,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

// Hook to use the chat context
export function useChatContext() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
}
