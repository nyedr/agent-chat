"use server";

import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import {
  generateUUID,
  getValidatedPath,
  parseChatFromDB,
  parseChatToDB,
  UPLOADS_DIR,
  validateUUID,
} from "@/lib/utils";
import { getDb } from "@/lib/db/init";
import { chat, folder, document, type Document } from "@/lib/db/schema";
import { Message } from "ai";
import {
  ScrapeProcessResponse,
  ScrapeResult,
  RerankResponse,
} from "@/lib/search/types";
import { join } from "path";
import { ArtifactKind } from "@/components/artifact";
import { readdir } from "fs/promises";
import { existsSync, writeFile } from "fs";

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
        documents: [],
        uploadedFiles: [],
        error: new Error("Chat not found"),
        status: 404,
      };
    }

    const documents = await getDocumentsByChatId({ chatId: id });
    const uploadedFiles = await getUploadedFiles(id);

    return {
      data: selectedChat,
      documents,
      uploadedFiles,
      error: null,
      status: 200,
    };
  } catch (error) {
    console.error("Failed to get chat by id:", error);
    const errorMessage =
      error instanceof Error ? error : new Error("Unknown error");
    return {
      data: null,
      documents: [],
      uploadedFiles: [],
      error: errorMessage,
      status: 500,
    };
  }
}

export async function deleteByChatId(id: string) {
  try {
    validateUUID(id);
    const db = await getDb();

    await db.transaction(async (tx) => {
      // 1. Find and Delete associated documents FIRST
      const documentsToDelete = tx
        .select({ id: document.id }) // Only need ID if logging/checking
        .from(document)
        .where(eq(document.chatId, id))
        .all(); // Fetch IDs to know how many *should* be deleted

      if (documentsToDelete.length > 0) {
        console.log(
          `[deleteByChatId:TX] Deleting ${documentsToDelete.length} documents for chat ${id}`
        );
        const documentDeleteResult = tx
          .delete(document)
          .where(eq(document.chatId, id))
          .run();
        console.log(
          `[deleteByChatId:TX] Deleted ${
            documentDeleteResult.changes ?? 0
          } documents.`
        );
        // Optional: Check if documentDeleteResult.changes matches documentsToDelete.length
      } else {
        console.log(`[deleteByChatId:TX] No documents found for chat ${id}.`);
      }

      // 2. Now, delete the chat record itself
      console.log(`[deleteByChatId:TX] Deleting chat record ${id}`);
      const chatDeleteResult = tx.delete(chat).where(eq(chat.id, id)).run();

      if (!chatDeleteResult?.changes) {
        // If the chat didn't exist, maybe that's okay, or maybe it's an error?
        // Throwing an error might be safer if the caller expects the chat to exist.
        console.warn(
          `[deleteByChatId:TX] Chat record ${id} deletion resulted in no changes. It might not have existed.`
        );
        // throw new Error("Failed to delete chat record, it might not have existed.");
      }
    }); // End transaction

    console.log(
      `[deleteByChatId] Successfully deleted DB records for chat ${id}`
    );
    return { success: true };
  } catch (error) {
    console.error(`[deleteByChatId] Failed for chat ${id}:`, error);
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
          parts: msg.parts?.map((part) => {
            if (part.type === "text") {
              return {
                ...part,
                text: content,
              };
            }
            return part;
          }),
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
  chatId,
  extension,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  chatId?: string;
  extension?: string;
}) {
  try {
    validateUUID(id);
    const db = await getDb();

    // Check if a document with this ID already exists
    const existingDoc = db
      .select({ id: document.id })
      .from(document)
      .where(eq(document.id, id))
      .limit(1)
      .get();

    if (existingDoc) {
      // --- UPDATE Existing Document --- //
      // Typically called by handlers after initial creation or for non-versioned updates
      console.log(`[ACTION] Updating document ${id}`);
      const result = db
        .update(document)
        .set({
          title, // Allow updating title
          content,
          kind, // Allow updating kind?
          // Do NOT update createdAt, chatId, or extension on update
        })
        .where(eq(document.id, id))
        // IMPORTANT: Ensure we only update the *latest* if multiple existed (though ID should be unique now)
        // This WHERE clause might need adjustment if ID wasn't unique. Assuming ID is unique/PK.
        .run();

      if (!result?.changes) {
        // Log instead of throwing? Update might not change if content is same
        console.warn(`Document ${id} update resulted in no changes.`);
        // throw new Error(`Failed to update document ${id}`);
      }
    } else {
      // --- INSERT New Document (First Version) --- //
      // Requires chatId for the first insertion
      if (!chatId) {
        throw new Error(
          `chatId is required when creating the first record for document ${id}`
        );
      }
      console.log(`[ACTION] Inserting first version for document ${id}`);
      validateUUID(chatId);
      const result = db
        .insert(document)
        .values({
          id,
          title,
          kind,
          content,
          chatId,
          extension: extension ?? undefined,
          createdAt: new Date().toISOString(),
        })
        .run();

      if (!result?.changes) {
        throw new Error(
          `Failed to insert initial document record for id ${id}`
        );
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`Failed to save document for id ${id}:`, error);
    throw error;
  }
}

export async function getDocumentsByChatId({
  chatId,
}: {
  chatId: string;
}): Promise<Document[]> {
  try {
    validateUUID(chatId);
    const db = await getDb();
    const docs = db
      .select()
      .from(document)
      .where(eq(document.chatId, chatId))
      .all();
    return docs;
  } catch (error) {
    console.error("Failed to get documents by chat id:", error);
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
    console.error("Failed to delete documents after timestamp:", error);
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
    db.update(chat)
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

export async function addChatMessage({
  chatId,
  message,
  isRetry = false,
}: {
  chatId: string;
  message: Message;
  isRetry?: boolean;
}) {
  try {
    validateUUID(chatId);
    const db = await getDb();

    // 1. Fetch existing chat data
    const existingChatData = db
      .select()
      .from(chat)
      .where(eq(chat.id, chatId))
      .get();

    if (!existingChatData) {
      console.error(`[addChatMessage] Chat not found: ${chatId}`);
      throw new Error(`Chat not found: ${chatId}`);
    }

    // 2. Parse existing history
    let existingHistory = parseChatFromDB(existingChatData.chat);
    let messages = existingHistory.messages;

    // 3. Handle retry logic: Remove last assistant message if necessary
    if (isRetry && messages.length > 0) {
      const lastMessage = messages.at(-1);
      if (lastMessage?.role === "assistant") {
        console.log(
          `[addChatMessage] Retrying: Removing last assistant message (ID: ${lastMessage.id}) for chat ${chatId}`
        );
        messages = messages.slice(0, -1); // Remove the last message
      } else {
        console.warn(
          `[addChatMessage] Retry requested for chat ${chatId}, but last message was not from assistant.`
        );
      }
    }

    // 4. Append the new message
    const newMessages = [...messages, message];

    console.log(
      `[addChatMessage] Updating chat ${chatId} with ${newMessages.length} messages. New message ID: ${message.id}, role: ${message.role}`
    );

    // 5. Update the chat record in the database
    const updatedHistory = {
      currentId: existingHistory.currentId,
      messages: newMessages,
    };

    const dbUpdateResult = db
      .update(chat)
      .set({
        chat: parseChatToDB(updatedHistory),
        updated_at: new Date().toISOString(),
      })
      .where(eq(chat.id, chatId))
      .run();

    if (!dbUpdateResult?.changes) {
      console.error(
        `[addChatMessage] Failed to update chat ${chatId}. No changes detected.`
      );
      // Consider if throwing an error is appropriate if an update was expected
      // throw new Error(`Failed to update chat history for chat ${chatId}`);
    }

    console.log(`[addChatMessage] Successfully updated chat ${chatId}`);
    return { success: true };
  } catch (error) {
    console.error(
      `[addChatMessage] Failed to add message to chat ${chatId}:`,
      error
    );
    // Re-throw the error to be handled by the caller (e.g., the API route)
    throw error;
  }
}

const PYTHON_SERVER_URL =
  process.env.PYTHON_SERVER_URL ?? "http://localhost:5328";

// ============== EMBEDDING FUNCTIONALITY ==============

const PYTHON_EMBED_URL = PYTHON_SERVER_URL + "/api/python/embed";

/**
 * Fetches embeddings for a list of texts from the Python backend.
 * @param texts - An array of strings to embed.
 * @returns A promise that resolves to an array of embedding vectors (number[][]).
 */
export async function getEmbeddingsFromPython(
  texts: string[]
): Promise<number[][]> {
  if (!texts || texts.length === 0) {
    return [];
  }

  console.log(
    `[ACTION] Requesting embeddings for ${texts.length} texts from Python server: ${PYTHON_EMBED_URL}`
  );

  try {
    const response = await fetch(PYTHON_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ texts }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Python embedding server error (${response.status}): ${errorBody}`
      );
      throw new Error(
        `Failed to get embeddings from Python server: ${response.statusText}`
      );
    }

    const result = await response.json();

    if (!result || !Array.isArray(result.embeddings)) {
      console.error(
        "Invalid response format from Python embedding server:",
        result
      );
      throw new Error("Invalid response format from Python embedding server.");
    }

    console.log(
      `[ACTION] Received ${result.embeddings.length} embeddings from Python server.`
    );
    return result.embeddings;
  } catch (error) {
    console.error("Error calling Python embedding server:", error);
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

// ============== SCRAPING & PROCESSING FUNCTIONALITY ==============

const PYTHON_SCRAPE_URL = PYTHON_SERVER_URL + "/api/python/scrape-process";

/**
 * Fetches processed content for a list of URLs from the Python backend.
 */
export async function scrapeAndProcessUrls({
  urls,
  query,
  extractTopKChunks,
  crawlingStrategy,
}: {
  urls: string[];
  query?: string;
  extractTopKChunks?: number;
  crawlingStrategy?: "http" | "playwright";
}): Promise<ScrapeProcessResponse> {
  if (!urls || urls.length === 0) {
    return { results: [] };
  }

  console.log(
    `[ACTION] Requesting scrape/process for ${
      urls.length
    } URLs from Python: ${PYTHON_SCRAPE_URL} (Strategy: ${
      crawlingStrategy || "http (default)"
    })`
  );

  const payload: any = { urls };
  if (query) payload.query = query;
  if (extractTopKChunks) payload.extract_top_k_chunks = extractTopKChunks;
  if (crawlingStrategy) payload.crawling_strategy = crawlingStrategy;

  try {
    const response = await fetch(PYTHON_SCRAPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Python scrape/process server error (${response.status}): ${errorBody}`
      );
      // Return success=false for all URLs in case of server error
      const errorResults: ScrapeResult[] = urls.map((url) => ({
        url,
        success: false,
        error: `Python server error: ${response.status} ${response.statusText}`,
        title: null,
        publishedDate: null,
        raw_content: null,
        quality_score: 0,
        processed_content: null,
        relevant_chunks: null,
      }));
      return { results: errorResults };
    }

    const result: ScrapeProcessResponse = await response.json();

    if (!result || !Array.isArray(result.results)) {
      console.error(
        "Invalid response format from Python scrape/process server:",
        result
      );
      throw new Error(
        "Invalid response format from Python scrape/process server."
      );
    }

    console.log(
      `[ACTION] Received ${result.results.length} processed scrape results from Python.`
    );
    return result;
  } catch (error) {
    console.error("Error calling Python scrape/process server:", error);
    // Return success=false for all URLs in case of network or other errors
    const errorResults: ScrapeResult[] = urls.map((url) => ({
      url,
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error during scrape/process call",
      title: null,
      publishedDate: null,
      raw_content: null,
      quality_score: 0,
      processed_content: null,
      relevant_chunks: null,
    }));
    return { results: errorResults };
  }
}

// ============== RERANKING FUNCTIONALITY ==============

const PYTHON_RERANK_URL = PYTHON_SERVER_URL + "/api/python/rerank";

/**
 * Reranks documents using the Python backend.
 */
export async function rerankDocuments(
  query: string,
  documents: { id: string; text: string }[],
  topK: number
): Promise<RerankResponse> {
  if (!query || !documents || documents.length === 0) {
    return { reranked_documents: [] };
  }

  console.log(
    `[ACTION] Requesting rerank for ${documents.length} documents from Python: ${PYTHON_RERANK_URL}`
  );

  try {
    const response = await fetch(PYTHON_RERANK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, documents, top_k: topK }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Python rerank server error (${response.status}): ${errorBody}`
      );
      throw new Error(
        `Failed to rerank documents via Python server: ${response.statusText}`
      );
    }

    const result: RerankResponse = await response.json();

    if (!result || !Array.isArray(result.reranked_documents)) {
      console.error(
        "Invalid response format from Python rerank server:",
        result
      );
      throw new Error("Invalid response format from Python rerank server.");
    }

    console.log(
      `[ACTION] Received ${result.reranked_documents.length} reranked documents from Python.`
    );
    return result;
  } catch (error) {
    console.error("Error calling Python rerank server:", error);
    throw error; // Re-throw to be handled by caller
  }
}

export const getUploadedFiles = async (
  chatId: string
): Promise<{ filename: string; url: string }[]> => {
  validateUUID(chatId);
  const chatUploadDir = join(UPLOADS_DIR, chatId);

  try {
    // Check if the directory exists (synchronously) before trying to read it asynchronously
    if (!existsSync(chatUploadDir)) {
      console.log(
        `Upload directory not found for chat ${chatId}, returning empty list.`
      );
      return []; // Return empty array if directory doesn't exist
    }

    const files = await readdir(chatUploadDir);
    // Return filename and the web-accessible URL
    return files.map((file) => ({
      filename: file,
      url: `/api/uploads/${chatId}/${file}`, // Construct the correct URL
    }));
  } catch (error) {
    console.error(`Error reading upload directory for chat ${chatId}:`, error);
    // Return empty array or re-throw based on desired error handling
    return [];
  }
};

/**
 * Creates a new version of an existing document.
 * Fetches metadata (chatId, extension) from the latest existing version
 * and inserts a new row with the same ID but new content and timestamp.
 */
export async function createNewDocumentVersion({
  id,
  title,
  kind,
  content,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
}) {
  try {
    validateUUID(id);
    const db = await getDb();

    // Fetch the latest existing version to get metadata
    const latestExistingDoc = db
      .select({
        chatId: document.chatId,
        extension: document.extension,
        // Select title/kind as well in case they were changed in the *very* latest update
        // Although the caller should ideally pass the intended title/kind for the new version
        title: document.title,
        kind: document.kind,
      })
      .from(document)
      .where(eq(document.id, id))
      .orderBy(sql`${document.createdAt} DESC`)
      .limit(1)
      .get();

    if (!latestExistingDoc) {
      throw new Error(
        `Cannot create new version: No existing document found with id ${id}`
      );
    }
    if (!latestExistingDoc.chatId) {
      throw new Error(
        `Corrupted data: Latest existing document ${id} has null chatId.`
      );
    }

    console.log(`[ACTION] Inserting new version for document ${id}`);
    // Insert the new version
    const result = db
      .insert(document)
      .values({
        id, // Same ID
        title, // Use title passed to this function
        kind, // Use kind passed to this function
        content,
        chatId: latestExistingDoc.chatId, // Carry over chatId
        extension: latestExistingDoc.extension ?? undefined, // Carry over extension
        createdAt: new Date().toISOString(), // New timestamp
      })
      .run();

    if (!result?.changes) {
      throw new Error(`Failed to insert new version for document ${id}`);
    }

    return { success: true };
  } catch (error) {
    console.error(`Failed to create new document version for id ${id}:`, error);
    throw error;
  }
}

export async function documentToTempFile({
  id,
  chatId,
}: {
  id: string;
  chatId: string;
}) {
  try {
    validateUUID(id);

    const documents = await getDocumentsById({ id });

    const document = documents[0];

    if (!document || !document.content) {
      throw new Error(`Valid document not found for id ${id}`);
    }

    const tempFilePath = getValidatedPath(
      chatId,
      `${document.id}.${document.extension}`
    );

    if (!tempFilePath) {
      throw new Error(`Failed to get validated path for document ${id}`);
    }

    writeFile(
      tempFilePath,
      document.content,
      {
        encoding: "utf-8",
      },
      (err) => {
        if (err) {
          throw new Error(`Failed to write file ${tempFilePath}: ${err}`);
        }
      }
    );

    return {
      success: true,
      tempFilePath,
    };
  } catch (error) {
    console.error(`Failed to create temp file for document ${id}:`, error);
    throw error;
  }
}
