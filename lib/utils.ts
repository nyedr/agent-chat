import type { Message } from "ai";
import {
  FileText,
  FileCode,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
  FileSpreadsheet,
  LucideIcon,
  Presentation,
  Book,
  FileQuestion,
} from "lucide-react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Document } from "@/lib/db/schema";
import path, { join } from "path";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const UPLOADS_DIR = join(process.cwd(), "data", "uploads");

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

export function getValidatedPath(
  chatId: string,
  relativePath: string
): string | null {
  if (!chatId) {
    console.error("getValidatedPath requires a valid chatId.");
    return null;
  }

  // Define the base path for the specific chat
  const chatUploadsDir = path.resolve(UPLOADS_DIR, chatId);

  // Basic sanitization: remove leading/trailing slashes, prevent directory traversal
  const sanitizedRelativePath = relativePath
    .replace(/^\/+/, "")
    .replace(/\/$/, "")
    .replace(/\.\.\//g, ""); // Remove ../ attempts

  if (!sanitizedRelativePath) {
    console.error("Invalid relative path after sanitization.");
    return null;
  }

  // Resolve the target path within the chat-specific directory
  const absoluteTargetPath = path.resolve(
    chatUploadsDir,
    sanitizedRelativePath
  );

  // Security Check: Ensure the resolved path is still within the specific chat's upload directory
  if (!absoluteTargetPath.startsWith(chatUploadsDir)) {
    console.error(
      `Path traversal attempt detected: ${relativePath} resolves outside of ${chatUploadsDir}`
    );
    return null; // Path traversal detected
  }

  return absoluteTargetPath;
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

/**
 * Processes search results from message parts and returns an array of source objects
 */
export function extractSearchSources(messageParts: any[] | undefined): Array<{
  title: string;
  url: string;
  description: string;
  source: string;
  relevance: number;
}> {
  if (!messageParts) return [];

  const sources: Array<{
    title: string;
    url: string;
    description: string;
    source: string;
    relevance: number;
  }> = [];

  messageParts.forEach((part) => {
    try {
      if (
        part.type === "tool-invocation" &&
        part.toolInvocation.toolName === "search" &&
        part.toolInvocation.state === "result"
      ) {
        const searchResults = part.toolInvocation.result.data.map(
          (item: any, index: number) => ({
            title: item.title,
            url: item.url,
            description: item.description,
            source: new URL(item.url).hostname,
            relevance: 1 - index * 0.1, // Decrease relevance for each subsequent result
          })
        );
        sources.push(...searchResults);
      }
    } catch (error) {
      console.error("Error processing search results:", error);
    }
  });

  return sources;
}

/**
 * Calculates progress percentage
 */
export function calculateProgressPercentage(
  completed: number,
  total: number
): number {
  if (total === 0) return 0;
  return Math.min((completed / total) * 100, 100);
}

/**
 * Formats milliseconds into MM:SS format
 */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Normalizes a URL for comparison and deduplication
 *
 * @param url - URL to normalize
 * @returns Normalized URL string
 */
export function normalizeUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);

    // Remove trailing slash
    let path = parsedUrl.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }

    // Remove common parameters that don't affect content
    parsedUrl.searchParams.delete("utm_source");
    parsedUrl.searchParams.delete("utm_medium");
    parsedUrl.searchParams.delete("utm_campaign");

    // Normalize to lowercase
    const normalized = `${parsedUrl.hostname.toLowerCase()}${path.toLowerCase()}`;

    return normalized;
  } catch (e) {
    // If URL parsing fails, return the original
    return url;
  }
}

export const linkRegex =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

/**
 * Checks if a string contains any links
 * @param str - The string to check for links
 * @returns True if the string contains links, false otherwise
 */
export function hasLink(str: string): boolean {
  return linkRegex.test(str);
}

/**
 * Extracts all links from a string
 * @param str - The string to extract links from
 * @returns An array of links found in the string
 */
export function extractLinks(str: string): string[] {
  return str.match(linkRegex) || [];
}

export function getFaviconUrl(url: string): string {
  const hostname = new URL(url).hostname;
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
}

/**
 * Extracts a filename suitable for download from link text or URL.
 *
 * @param children - The React node(s) representing the link text.
 * @param href - The URL of the link.
 * @returns A plausible filename string.
 */
export function getDownloadFilename(
  children: React.ReactNode,
  href: string
): string {
  // Try to get from children first (e.g., [Download my_file.txt](...))
  let potentialFilename = Array.isArray(children)
    ? children.join("")
    : String(children);

  // Remove common prefixes like "Download "
  if (potentialFilename.toLowerCase().startsWith("download ")) {
    potentialFilename = potentialFilename.substring(9).trim();
  }

  // Check if the extracted text looks like a filename (basic check for extension)
  if (potentialFilename && potentialFilename.includes(".")) {
    return potentialFilename;
  }

  // Fallback to extracting from the last part of the URL path
  try {
    const url = new URL(href, "http://dummybase"); // Use dummy base for relative paths
    const pathParts = url.pathname.split("/");
    const lastPart = pathParts[pathParts.length - 1];
    // Decode URI component in case filename is encoded
    const decodedFilename = lastPart ? decodeURIComponent(lastPart) : "";
    return decodedFilename || "download"; // Default to 'download' if empty
  } catch {
    // Further fallback if URL parsing fails
    return "download";
  }
}

/**
 * Extracts the relative path starting with '/api/uploads/' from a potentially malformed URL.
 *
 * @param url - The input URL string, which might have incorrect prefixes.
 * @returns The extracted relative path (e.g., '/api/uploads/...'), or the original string if '/api/uploads/' is not found or the input is invalid.
 */
export function getRelativePath(url: string | null | undefined): string {
  if (typeof url !== "string" || !url) {
    return ""; // Return empty string for invalid input
  }

  const marker = "/api/uploads/";
  const index = url.indexOf(marker);

  if (index !== -1) {
    // Found the marker, return the substring from the marker onwards
    return url.substring(index);
  }

  // Marker not found, return the original string as a fallback
  return url;
}

/**
 * Formats file size in bytes into a human-readable string (KB, MB, GB).
 *
 * @param bytes - File size in bytes.
 * @param decimals - Number of decimal places (default: 2).
 * @returns Human-readable file size string.
 */
export function formatFileSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Maps common file extensions to a simplified file type category.
 *
 * @param extension - The file extension (e.g., 'pdf', 'docx', 'png').
 * @returns A file type category (e.g., 'text', 'image', 'code') or 'unknown'.
 */
export function getFileTypeFromExtension(extension: string): string {
  if (!extension) return "unknown";
  const ext = extension.toLowerCase();

  // Document Types
  if (["txt", "md", "rtf", "log"].includes(ext)) return "text";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "odt"].includes(ext)) return "document";
  if (["ppt", "pptx", "odp"].includes(ext)) return "presentation";

  // Code Types
  if (
    [
      "py",
      "js",
      "ts",
      "jsx",
      "tsx",
      "html",
      "css",
      "json",
      "yaml",
      "yml",
      "sh",
      "bash",
    ].includes(ext)
  )
    return "code";

  // Image Types
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext))
    return "image";

  // Audio Types
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "audio";

  // Video Types
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";

  // Spreadsheet Types
  if (["csv", "xls", "xlsx"].includes(ext)) return "spreadsheet";

  // Archive Types
  if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) return "archive";

  return "unknown"; // Default for unmapped types
}

/**
 * Returns a Lucide icon component based on the simplified file type.
 *
 * @param fileType - The file type category (e.g., 'text', 'image').
 * @returns A LucideIcon component or null.
 */
export function getFileIcon(fileType: string): LucideIcon {
  switch (fileType) {
    case "text":
      return FileText;
    case "pdf":
      return FileText;
    case "document":
      return Book;
    case "presentation":
      return Presentation;
    case "code":
      return FileCode;
    case "image":
      return FileImage;
    case "audio":
      return FileAudio;
    case "video":
      return FileVideo;
    case "spreadsheet":
      return FileSpreadsheet;
    case "archive":
      return FileArchive;
    case "unknown":
    default:
      return FileQuestion;
  }
}

/**
 * Gets Tailwind CSS color classes (text and background) based on file type.
 * @param fileType - The simplified file type category.
 * @returns A string containing Tailwind classes like "text-blue-500 bg-blue-500/10".
 */
export function getColorForFileType(type: string): string {
  switch (type.toLowerCase()) {
    case "pdf":
      return "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30";
    case "image":
      return "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30";
    case "text":
      return "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30";
    case "document":
      return "text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/30";
    case "spreadsheet":
      return "text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30";
    case "presentation":
      return "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30";
    case "archive":
      return "text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30";
    case "code":
      return "text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-900/30";
    case "audio":
      return "text-pink-600 dark:text-pink-400 bg-pink-100 dark:bg-pink-900/30";
    case "video":
      return "text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30";
    default: // unknown
      return "text-zinc-600 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-700/30";
  }
}

/**
 * Extracts relevant file information from a URL and an optional display name.
 *
 * @param url - The URL of the file (can be relative or absolute).
 * @param displayNameFromProps - The filename provided as a prop (potentially from link text).
 * @returns An object containing file details.
 */
export function getFileInfoFromUrl(
  url: string | null | undefined,
  displayNameFromProps: string | null | undefined
): {
  actualFilename: string;
  displayFilename: string;
  extension: string;
  fileType: string;
  IconComponent: LucideIcon;
  colorClass: string;
} {
  const defaultResult = {
    actualFilename: "file",
    displayFilename: "file",
    extension: "",
    fileType: "unknown",
    IconComponent: FileQuestion,
    colorClass: getColorForFileType("unknown"),
  };

  // Clean up display name from potential markdown link syntax
  const cleanedDisplayName =
    (displayNameFromProps || "")
      .replace(/^\s*\[?([^\]]+?)\]?\(.*\)\s*$/, "$1")
      .trim() || "file";

  if (typeof url !== "string" || !url) {
    // If no URL, try to derive from display name, otherwise return default
    const extFromDisplay = cleanedDisplayName.includes(".")
      ? cleanedDisplayName.split(".").pop()?.toLowerCase() || ""
      : "";
    if (extFromDisplay) {
      const fileType = getFileTypeFromExtension(extFromDisplay);
      return {
        actualFilename: cleanedDisplayName,
        displayFilename: cleanedDisplayName,
        extension: extFromDisplay,
        fileType: fileType,
        IconComponent: getFileIcon(fileType),
        colorClass: getColorForFileType(fileType),
      };
    }
    return { ...defaultResult, displayFilename: cleanedDisplayName };
  }

  let actualFilename = "file";
  let extension = "";
  try {
    const path = new URL(url, "http://dummybase").pathname;
    actualFilename = decodeURIComponent(
      path.substring(path.lastIndexOf("/") + 1)
    );
    extension = actualFilename.includes(".")
      ? actualFilename.split(".").pop()?.toLowerCase() || ""
      : "";
  } catch (e) {
    console.error("Error parsing URL for file info:", url, e);
    // Fallback: try extension from cleaned display name if URL parsing failed
    extension = cleanedDisplayName.includes(".")
      ? cleanedDisplayName.split(".").pop()?.toLowerCase() || ""
      : "";
    actualFilename = cleanedDisplayName || "file"; // Use display name if URL failed
  }

  const fileType = getFileTypeFromExtension(extension);
  const IconComponent = getFileIcon(fileType);
  const colorClass = getColorForFileType(fileType);

  // Use cleanedDisplayName for display unless it's just 'file' and actualFilename is better
  const displayFilename =
    cleanedDisplayName === "file" && actualFilename !== "file"
      ? actualFilename
      : cleanedDisplayName;

  return {
    actualFilename, // The filename extracted from the URL
    displayFilename, // The filename intended for display (from props or URL fallback)
    extension,
    fileType,
    IconComponent,
    colorClass,
  };
}
