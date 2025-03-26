"use server";

import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import {
  generateUUID,
  parseChatFromDB,
  parseChatToDB,
  validateUUID,
} from "@/lib/utils";
import { getDb } from "@/lib/db/init";
import {
  chat,
  document,
  folder,
  Suggestion,
  suggestion,
} from "@/lib/db/schema";
import { Message } from "ai";

export async function saveChat({
  id,
  title,
  folder_id = null,
  meta = {},
}: {
  id: string;
  title: string;
  folder_id?: string | null;
  meta?: Record<string, unknown>;
}) {
  try {
    validateUUID(id);

    const db = await getDb();
    const result = db
      .insert(chat)
      .values({
        id,
        title: title.substring(0, 100),
        folder_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        chat: parseChatToDB({
          currentId: null,
          messages: [],
        }),
        meta: JSON.stringify(meta || {}),
        archived: false,
      })
      .run();

    if (!result?.changes) {
      throw new Error("Failed to insert chat record");
    }

    return { success: true, id };
  } catch (error) {
    console.error("Failed to save chat:", error);
    throw error;
  }
}

export async function getAllChats() {
  try {
    const db = await getDb();
    const chats = db
      .select({
        chat: chat,
        folder: folder,
      })
      .from(chat)
      .leftJoin(folder, eq(chat.folder_id, folder.id))
      .orderBy(sql`${chat.created_at} DESC`)
      .all();

    return chats.map(({ chat, folder }) => ({
      ...chat,
      folder: folder || null,
    }));
  } catch (error) {
    console.error("Failed to get all chats");
    throw error;
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    validateUUID(id);

    const db = await getDb();
    const selectedChat = db.select().from(chat).where(eq(chat.id, id)).get();

    if (!selectedChat) {
      return {
        data: null,
        error: new Error("Chat not found"),
        status: 404,
      };
    }

    return {
      data: selectedChat,
      error: null,
      status: 200,
    };
  } catch (error) {
    console.error("Failed to get chat by id:", error);
    if (error instanceof Error) {
      return {
        data: null,
        error,
        status: 500,
      };
    }
    return {
      data: null,
      error: new Error("Unknown error"),
      status: 500,
    };
  }
}

export async function deleteChatById(id: string) {
  try {
    const db = await getDb();
    const result = db.delete(chat).where(eq(chat.id, id)).run();

    if (!result?.changes) {
      throw new Error("Failed to delete chat");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to delete chat:", error);
    throw error;
  }
}

export async function updateChatHistory({
  id,
  history,
}: {
  id: string;
  history: {
    currentId: string | null;
    messages: Message[];
  };
}) {
  try {
    validateUUID(id);

    console.log(
      `[ACTION] updateChatHistory called for chat ${id} with ${history.messages.length} messages`
    );

    // Sanitize message content to remove any SSE formatting
    const sanitizedMessages = history.messages.map((msg) => ({
      ...msg,
      content: msg.content,
    }));

    const sanitizedHistory = {
      currentId: history.currentId,
      messages: sanitizedMessages,
    };

    console.log(
      `[ACTION] Processed ${sanitizedMessages.length} messages for saving, currentId: ${history.currentId}`
    );

    // Check if the DB has the chat
    const db = await getDb();
    const existingChat = db.select().from(chat).where(eq(chat.id, id)).get();

    if (!existingChat) {
      // Log detailed error information
      console.error(
        `[ACTION] Chat ${id} not found in database when trying to update history`
      );
      console.error(
        `[ACTION] Current message count: ${sanitizedMessages.length}`
      );

      if (sanitizedMessages.length > 0) {
        console.error(
          `[ACTION] First message: ${sanitizedMessages[0].role}/${sanitizedMessages[0].id}`
        );
        console.error(
          `[ACTION] Last message: ${
            sanitizedMessages[sanitizedMessages.length - 1].role
          }/${sanitizedMessages[sanitizedMessages.length - 1].id}`
        );
      }

      // Simple error, no auto-creation
      throw new Error(`Chat not found (ID: ${id})`);
    }

    // Serialize the chat data
    const chatJson = parseChatToDB(sanitizedHistory);

    // Log a preview of what we're about to save
    console.log(
      `[ACTION] Saving chat with ${sanitizedMessages.length} messages (JSON length: ${chatJson.length})`
    );

    const result = db
      .update(chat)
      .set({
        chat: chatJson,
        updated_at: new Date().toISOString(),
      })
      .where(eq(chat.id, id))
      .run();

    if (!result?.changes) {
      throw new Error("Failed to update chat history");
    }

    // Verify the update
    const updatedChat = db.select().from(chat).where(eq(chat.id, id)).get();
    if (updatedChat) {
      try {
        const savedData = parseChatFromDB(updatedChat.chat);
        console.log(
          `[ACTION] Verified ${savedData.messages.length} messages were saved to DB`
        );
      } catch (e) {
        console.error(`[ACTION] Error parsing saved chat: ${e}`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update chat history:", error);
    throw error;
  }
}

export async function saveModelId(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("model-id", model);
}

export async function deleteTrailingMessages({
  id,
  messageId,
}: {
  id: string;
  messageId: string;
}) {
  try {
    // Get the chat containing the message
    const chat = await getChatById({ id });
    if (!chat.data) {
      throw new Error("Chat not found");
    }

    const chatData = parseChatFromDB(chat.data.chat);
    const messageIndex = chatData.messages.findIndex(
      (msg: Message) => msg.id === messageId
    );
    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    // Keep only messages up to but not including the specified message
    const updatedMessages = chatData.messages.slice(0, messageIndex);

    // If no messages are left, set currentId to null, otherwise use the last message's id
    const currentId =
      updatedMessages.length > 0
        ? updatedMessages[updatedMessages.length - 1].id
        : null;

    // Update chat history with truncated messages
    await updateChatHistory({
      id: chat.data.id,
      history: {
        messages: updatedMessages,
        currentId,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to delete trailing messages:", error);
    throw error;
  }
}

export async function deleteSingleMessage({
  id,
  messageId,
}: {
  id: string;
  messageId: string;
}) {
  try {
    // Get the chat containing the message
    const chat = await getChatById({ id });
    if (!chat.data) {
      throw new Error("Chat not found");
    }

    const chatData = parseChatFromDB(chat.data.chat);
    const messageIndex = chatData.messages.findIndex(
      (msg: Message) => msg.id === messageId
    );

    console.log("chatData for message deletions", chatData);

    if (messageIndex === -1) {
      throw new Error("Message not found");
    }

    // Filter out only the specified message
    const updatedMessages = chatData.messages.filter(
      (msg: Message) => msg.id !== messageId
    );

    // If no messages are left, set currentId to null, otherwise use the last message's id
    const currentId =
      updatedMessages.length > 0
        ? updatedMessages[updatedMessages.length - 1].id
        : null;

    // Update chat history with the updated messages
    await updateChatHistory({
      id: chat.data.id,
      history: {
        messages: updatedMessages,
        currentId,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to delete single message:", error);
    throw error;
  }
}

const MAX_TITLE_CHAR_LENGTH = 100;

export async function createNewChat({
  title,
  providedId,
}: {
  title: string;
  providedId?: string;
}) {
  try {
    // Use the provided ID if it exists, otherwise generate a new one
    const id = providedId || generateUUID();

    console.log(
      `[ACTION] Creating new chat with ID: ${id} (${
        providedId ? "provided" : "generated"
      })`
    );

    // Create the chat in the database
    return await saveChat({
      id,
      title: title.substring(0, MAX_TITLE_CHAR_LENGTH), // Limit title length
      folder_id: null,
    });
  } catch (error) {
    console.error("Failed to create chat:", error);
    throw new Error("Failed to create chat");
  }
}

export async function updateChatMessages(id: string, messages: Message[]) {
  try {
    validateUUID(id);

    // Only log essential information
    console.log(
      `[ACTION] Updating chat ${id} with ${messages.length} messages`
    );

    const db = await getDb();
    const existingChat = db.select().from(chat).where(eq(chat.id, id)).get();

    if (!existingChat) {
      throw new Error(`Chat not found with ID: ${id}`);
    }

    // Sanitize message content to remove any SSE formatting
    const sanitizedMessages = messages.map((msg) => ({
      ...msg,
      content: msg.content,
    }));

    const updateResult = db
      .update(chat)
      .set({
        chat: parseChatToDB({
          currentId:
            sanitizedMessages[sanitizedMessages.length - 1]?.id || null,
          messages: sanitizedMessages,
        }),
        updated_at: new Date().toISOString(),
      })
      .where(eq(chat.id, id))
      .run();

    if (!updateResult?.changes) {
      throw new Error("Failed to update chat messages");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update chat messages:", error);
    throw error;
  }
}

/**
 * Updates a specific message in a chat
 * @param chatId The ID of the chat
 * @param messageId The ID of the message to update
 * @param content The new content for the message
 * @returns An object indicating success or failure
 */
export async function updateMessageContent(
  chatId: string,
  messageId: string,
  content: string
) {
  try {
    validateUUID(chatId);
    validateUUID(messageId);

    console.log(`[ACTION] Updating message ${messageId} in chat ${chatId}`);

    const db = await getDb();
    const existingChat = db
      .select()
      .from(chat)
      .where(eq(chat.id, chatId))
      .get();

    if (!existingChat) {
      throw new Error(`Chat not found with ID: ${chatId}`);
    }

    // Parse the existing chat data
    let chatData;
    try {
      chatData = parseChatFromDB(existingChat.chat);
    } catch (e) {
      console.error("Failed to parse chat data:", e);
      throw new Error("Failed to parse chat data");
    }

    // Find and update the specific message
    const updatedMessages = chatData.messages.map((msg) => {
      if (msg.id === messageId) {
        return {
          ...msg,
          content,
        };
      }
      return msg;
    });

    // Update the chat with the modified messages
    const updateResult = db
      .update(chat)
      .set({
        chat: parseChatToDB({
          currentId: chatData.currentId,
          messages: updatedMessages,
        }),
        updated_at: new Date().toISOString(),
      })
      .where(eq(chat.id, chatId))
      .run();

    if (!updateResult?.changes) {
      throw new Error("Failed to update message content");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update message content:", error);
    throw error;
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
}: {
  id: string;
  title: string;
  kind: "text" | "code" | "image";
  content: string;
}) {
  try {
    validateUUID(id);
    const db = await getDb();
    const result = db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        createdAt: new Date().toISOString(),
      })
      .run();

    if (!result?.changes) {
      throw new Error("Failed to save document");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to save document:", error);
    throw error;
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    validateUUID(id);
    const db = await getDb();
    const doc = db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(sql`${document.createdAt} DESC`)
      .get();
    return doc;
  } catch (error) {
    console.error("Failed to get document by id:", error);
    throw error;
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    validateUUID(id);
    const db = await getDb();
    const docs = db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(sql`${document.createdAt} DESC`)
      .all();

    return docs;
  } catch (error) {
    console.error("Failed to get document by id:", error);
    throw error;
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    validateUUID(id);
    const db = await getDb();
    await db.transaction(async (tx) => {
      tx.delete(suggestion)
        .where(
          and(
            eq(suggestion.documentId, id),
            sql`${suggestion.documentCreatedAt} > ${timestamp.toISOString()}`
          )
        )
        .run();

      tx.delete(document)
        .where(
          and(
            eq(document.id, id),
            sql`${document.createdAt} > ${timestamp.toISOString()}`
          )
        )
        .run();
    });
    return { success: true };
  } catch (error) {
    console.error("Failed to delete documents:", error);
    throw error;
  }
}

export async function saveSuggestions(suggestions: Array<Suggestion>) {
  try {
    const db = await getDb();
    const suggestionsWithIds = suggestions.map((suggestion) => ({
      ...suggestion,
      id: generateUUID(),
    }));

    const result = db.insert(suggestion).values(suggestionsWithIds).run();

    if (!result?.changes) {
      throw new Error("Failed to save suggestions");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to save suggestions:", error);
    throw error;
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    validateUUID(documentId);
    const db = await getDb();
    return db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId))
      .all();
  } catch (error) {
    console.error("Failed to get suggestions:", error);
    throw error;
  }
}

export async function createFolder(name: string) {
  try {
    const id = generateUUID();
    const db = await getDb();

    const result = db
      .insert(folder)
      .values({
        id,
        name,
      })
      .run();

    if (!result?.changes) {
      throw new Error("Failed to create folder");
    }

    return { success: true, id };
  } catch (error) {
    console.error("Failed to create folder:", error);
    throw error;
  }
}

export async function getAllFolders() {
  try {
    const db = await getDb();
    const foldersWithChats = db
      .select({
        folder: folder,
        chats: chat,
      })
      .from(folder)
      .leftJoin(chat, eq(folder.id, chat.folder_id))
      .orderBy(sql`${folder.created_at} DESC`)
      .all();

    // Group chats by folder
    const folderMap = new Map();

    foldersWithChats.forEach(({ folder, chats }) => {
      if (!folderMap.has(folder.id)) {
        folderMap.set(folder.id, {
          ...folder,
          chats: [],
        });
      }
      if (chats) {
        folderMap.get(folder.id).chats.push(chats);
      }
    });

    return Array.from(folderMap.values());
  } catch (error) {
    console.error("Failed to get folders:", error);
    throw error;
  }
}

export async function updateFolder({ id, name }: { id: string; name: string }) {
  try {
    validateUUID(id);
    const db = await getDb();

    const result = db
      .update(folder)
      .set({
        name,
        updated_at: new Date().toISOString(),
      })
      .where(eq(folder.id, id))
      .run();

    if (!result?.changes) {
      throw new Error("Failed to update folder");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update folder:", error);
    throw error;
  }
}

export async function deleteFolder(id: string) {
  try {
    validateUUID(id);
    const db = await getDb();

    // First update all chats in this folder to have no folder
    await db
      .update(chat)
      .set({ folder_id: null })
      .where(eq(chat.folder_id, id))
      .run();

    // Then delete the folder
    const result = db.delete(folder).where(eq(folder.id, id)).run();

    if (!result?.changes) {
      throw new Error("Failed to delete folder");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to delete folder:", error);
    throw error;
  }
}

export async function updateChat({
  id,
  title,
  folder_id,
  archived,
}: {
  id: string;
  title?: string;
  folder_id?: string | null;
  archived?: boolean;
}) {
  try {
    validateUUID(id);
    const db = await getDb();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updates.title = title;
    if (folder_id !== undefined) updates.folder_id = folder_id;
    if (archived !== undefined) updates.archived = archived;

    const result = db.update(chat).set(updates).where(eq(chat.id, id)).run();

    if (!result?.changes) {
      throw new Error("Failed to update chat");
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to update chat:", error);
    throw error;
  }
}

/**
 * Saves chat messages to the database
 * @param chatId The chat ID
 * @param messages Array of messages to save
 * @returns Promise that resolves when save is complete
 */
export async function saveChatMessages({
  chatId,
  messages,
}: {
  chatId: string;
  messages: Message[];
}): Promise<Response | void> {
  const currentId =
    messages.length > 0 ? messages[messages.length - 1].id : null;

  await updateChatHistory({
    id: chatId,
    history: {
      currentId,
      messages,
    },
  });

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function addChatMessage({
  chatId,
  message,
}: {
  chatId: string;
  message: Message;
}) {
  try {
    validateUUID(chatId);

    const chat = await getChatById({ id: chatId });

    if (!chat.data) {
      throw new Error("Chat not found");
    }

    const chatData = parseChatFromDB(chat.data.chat);

    const updatedMessages = [...chatData.messages, message];

    await updateChatHistory({
      id: chatId,
      history: {
        currentId: chatData.currentId,
        messages: updatedMessages,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to add chat message:", error);
    throw error;
  }
}
