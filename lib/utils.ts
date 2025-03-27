import type {
  CoreAssistantMessage,
  CoreMessage,
  CoreToolMessage,
  FilePart,
  Message,
  TextPart,
  ToolCallPart,
  ToolInvocation,
} from "ai";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Document } from "@/lib/db/schema";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ApplicationError extends Error {
  info: string;
  status: number;
}

export const fetcher = async (url: string) => {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(
      "An error occurred while fetching the data."
    ) as ApplicationError;

    error.info = await res.json();
    error.status = res.status;

    throw error;
  }

  return res.json();
};

export function getLocalStorage(key: string) {
  if (typeof window !== "undefined") {
    return JSON.parse(localStorage.getItem(key) || "[]");
  }
  return [];
}

function addToolMessageToChat({
  toolMessage,
  messages,
}: {
  toolMessage: CoreToolMessage;
  messages: Array<Message>;
}): Array<Message> {
  return messages.map((message) => {
    if (message.toolInvocations) {
      return {
        ...message,
        toolInvocations: message.toolInvocations.map((toolInvocation) => {
          const toolResult = toolMessage.content.find(
            (tool) => tool.toolCallId === toolInvocation.toolCallId
          );

          if (toolResult) {
            return {
              ...toolInvocation,
              state: "result",
              result: toolResult.result,
            };
          }

          return toolInvocation;
        }),
      };
    }

    return message;
  });
}

export function getMessageContent(message: Message | CoreMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content.map((content) => (content as any).text).join("");
}

export function convertToUIMessages(
  messages: Array<Message | CoreMessage>
): Array<Message> {
  return messages.reduce((chatMessages: Array<Message>, message) => {
    // If it's already a UI Message with an id, just use it
    if ("id" in message) {
      return [...chatMessages, message as Message];
    }

    // Handle tool messages
    if (message.role === "tool") {
      return addToolMessageToChat({
        toolMessage: message as CoreToolMessage,
        messages: chatMessages,
      });
    }

    let textContent = "";
    const toolInvocations: Array<ToolInvocation> = [];

    if (typeof message.content === "string") {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === "text") {
          textContent += content.text;
        } else if (content.type === "tool-call") {
          toolInvocations.push({
            state: "call",
            toolCallId: content.toolCallId,
            toolName: content.toolName,
            args: content.args,
          });
        }
      }
    }

    chatMessages.push({
      ...message,
      id: (message as Message).id,
      role: message.role as Message["role"],
      content: textContent,
      toolInvocations,
    });

    return chatMessages;
  }, []);
}

export function sanitizeResponseMessages(
  messages: Array<CoreToolMessage | CoreAssistantMessage>
): CoreAssistantMessage & { parts: any[] } {
  const toolResultIds: Array<string> = [];
  const toolResultMap: Record<string, any> = {};

  // First pass: collect all tool result IDs and their results
  for (const message of messages) {
    if (message.role === "tool") {
      for (const content of message.content) {
        if (content.type === "tool-result") {
          toolResultIds.push(content.toolCallId);
          toolResultMap[content.toolCallId] = content.result;
        }
      }
    }
  }

  // Extract text content and tool calls from assistant messages
  const textParts: TextPart[] = [];
  const toolCallParts: ToolCallPart[] = [];
  const fileParts: FilePart[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        // Convert string content to TextPart
        textParts.push({ type: "text", text: message.content });
      } else if (Array.isArray(message.content)) {
        // Process each part of assistant message
        for (const part of message.content) {
          if (part.type === "text" && part.text.trim().length > 0) {
            textParts.push(part);
          } else if (
            part.type === "tool-call" &&
            toolResultIds.includes(part.toolCallId)
          ) {
            toolCallParts.push(part);
          } else if (part.type === "file") {
            fileParts.push(part);
          }
          // Skip other part types as they're not handled in the UI
        }
      }
    }
  }

  // Build assistantContent array (for CoreAssistantMessage.content)
  const assistantContent: (TextPart | FilePart | ToolCallPart)[] = [
    ...textParts,
    ...fileParts,
    ...toolCallParts,
  ];

  // Build UI-compatible parts array
  const uiParts = [];

  // Add text parts
  for (const part of textParts) {
    uiParts.push({
      type: "text",
      text: part.text,
    });
  }

  // Add file parts
  for (const part of fileParts) {
    uiParts.push({
      type: "file",
      mimeType: part.mimeType,
      data: typeof part.data === "string" ? part.data : "",
    });
  }

  // Add tool invocation parts
  toolCallParts.forEach((part) => {
    // Create tool invocation that can be used with the UI
    const toolInvocation = {
      state: toolResultMap[part.toolCallId] ? "result" : "call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: part.args,
    };

    // Add result if available
    if (toolResultMap[part.toolCallId]) {
      (toolInvocation as any).result = toolResultMap[part.toolCallId];
    }

    // Add to UI parts
    uiParts.push({
      type: "tool-invocation",
      toolInvocation,
    });
  });

  // Return a single assistant message with all needed properties
  return {
    role: "assistant",
    content: assistantContent,
    parts: uiParts,
  } as CoreAssistantMessage & { parts: any[] };
}

export function sanitizeUIMessages(messages: Array<Message>): Array<Message> {
  const messagesBySanitizedToolInvocations = messages.map((message) => {
    if (message.role !== "assistant") return message;

    if (!message.toolInvocations) return message;

    const toolResultIds: Array<string> = [];

    for (const toolInvocation of message.toolInvocations) {
      if (toolInvocation.state === "result") {
        toolResultIds.push(toolInvocation.toolCallId);
      }
    }

    const sanitizedToolInvocations = message.toolInvocations.filter(
      (toolInvocation) =>
        toolInvocation.state === "result" ||
        toolResultIds.includes(toolInvocation.toolCallId)
    );

    return {
      ...message,
      toolInvocations: sanitizedToolInvocations,
    };
  });

  return messagesBySanitizedToolInvocations.filter(
    (message) =>
      message.content.length > 0 ||
      (message.toolInvocations && message.toolInvocations.length > 0)
  );
}

export function getMostRecentUserMessage(messages: Array<Message>) {
  const userMessages = messages.filter((message) => message.role === "user");
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number
) {
  if (!documents) return new Date();
  if (index > documents.length) return new Date();

  return documents[index].createdAt;
}

export function getMessageIdFromAnnotations(message: Message) {
  if (!message.annotations) return message.id;

  const [annotation] = message.annotations;
  if (!annotation) return message.id;

  // @ts-expect-error messageIdFromServer is not defined in MessageAnnotation
  return annotation.messageIdFromServer;
}

export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 1000000);
}

/**
 * Generates a UUID v4 string
 * @returns A new UUID string
 */
export function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Parses chat data from the database format
 * Handles various legacy formats and ensures consistent output
 */
export function parseChatFromDB(chat: string): {
  currentId: string | null;
  messages: Message[];
} {
  try {
    if (!chat || typeof chat !== "string") {
      return { currentId: null, messages: [] };
    }

    const parsed = JSON.parse(chat);

    // Handle older format which had nested "history" property
    if (parsed.history) {
      return parsed.history;
    }

    // Handle direct message array format (legacy)
    if (Array.isArray(parsed)) {
      const messages = parsed.map((msg: any) => ({
        ...msg,
        content: msg.content,
      }));
      return {
        currentId:
          messages.length > 0 ? messages[messages.length - 1].id : null,
        messages,
      };
    }

    // Handle current format with currentId and messages
    if (parsed.messages) {
      // Ensure messages is an array
      if (!Array.isArray(parsed.messages)) {
        parsed.messages = [];
      }

      // Sanitize all message content
      parsed.messages = parsed.messages.map((msg: any) => ({
        ...msg,
        content: msg.content || "",
      }));

      // Ensure currentId is set correctly
      if (!parsed.currentId && parsed.messages.length > 0) {
        parsed.currentId = parsed.messages[parsed.messages.length - 1].id;
      }
    }

    return {
      currentId: parsed.currentId || null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (error) {
    // Return empty structure in case of error
    return {
      currentId: null,
      messages: [],
    };
  }
}

/**
 * Converts chat data to string format for database storage
 */
export function parseChatToDB(history: {
  currentId: string | null;
  messages: Message[];
}): string {
  try {
    // Final sanitize before saving
    const sanitized = {
      currentId: history.currentId,
      messages: history.messages.map((msg) => ({
        ...msg,
        content: msg.content || "",
      })),
    };
    return JSON.stringify(sanitized);
  } catch (error) {
    return JSON.stringify({
      currentId: null,
      messages: [],
    });
  }
}

/**
 * Validates a UUID string against the standard UUID v4 format
 * @param uuid The UUID string to validate
 * @throws Error if UUID is invalid
 */
export function validateUUID(uuid: string): void {
  if (!uuid || typeof uuid !== "string") {
    throw new Error("UUID must be a non-empty string");
  }
  if (uuid.length !== 36) {
    throw new Error(`Invalid UUID length: ${uuid.length} characters`);
  }
  // Check format: 8-4-4-4-12 with valid hex digits
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      uuid
    )
  ) {
    throw new Error(`Invalid UUID format: ${uuid}`);
  }
}

export const removeInlineTicks = (str: string): string => {
  return str.replace(/`/g, "");
};

export const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Define types that are not exported from the ai package
interface ReasoningPart {
  type: "reasoning";
  text: string;
}

interface RedactedReasoningPart {
  type: "redacted-reasoning";
  data: string;
}
