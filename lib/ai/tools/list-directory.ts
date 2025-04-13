import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { UPLOADS_DIR } from "@/lib/utils";

interface ListDirectoryProps {
  dataStream: DataStreamWriter;
  chatId?: string;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  lastModified?: string;
}

export interface ListDirectoryToolResult {
  path: string;
  files: FileEntry[];
  error?: string;
}

export const listDirectory = ({ dataStream, chatId }: ListDirectoryProps) =>
  tool({
    description:
      "Lists files and directories within a specified path in the chat's uploads directory.",
    parameters: z.object({
      path: z
        .string()
        .optional()
        .describe(
          "Relative path within uploads directory to list. Defaults to the root directory if not provided."
        ),
    }),
    execute: async ({
      path: subPath = "",
    }): Promise<ListDirectoryToolResult> => {
      if (!chatId) {
        return {
          path: subPath,
          files: [],
          error: "Chat ID is required to list files",
        };
      }

      // Sanitize the path to prevent directory traversal
      const sanitizedPath = path
        .normalize(subPath)
        .replace(/^(\.\.(\/|\\|$))+/, "");

      const targetPath = path.join(UPLOADS_DIR, chatId, sanitizedPath);

      try {
        // Check if directory exists
        const stat = await fs.stat(targetPath).catch(() => null);
        if (!stat) {
          return {
            path: subPath,
            files: [],
            error: `Directory does not exist: ${subPath || "/"}`,
          };
        }

        if (!stat.isDirectory()) {
          return {
            path: subPath,
            files: [],
            error: `Path is not a directory: ${subPath}`,
          };
        }

        // Read directory contents
        const entries = await fs.readdir(targetPath);
        const fileData: FileEntry[] = [];

        // Process each entry
        for (const entry of entries) {
          const entryPath = path.join(targetPath, entry);
          const entryStat = await fs.stat(entryPath).catch(() => null);

          if (entryStat) {
            fileData.push({
              name: entry,
              type: entryStat.isDirectory() ? "directory" : "file",
              size: entryStat.isFile() ? entryStat.size : undefined,
              lastModified: entryStat.mtime.toISOString(),
            });
          }
        }

        // Convert to plain objects for JSON compatibility
        const jsonCompatibleFiles = fileData.map((file) => ({
          ...file,
        }));

        // Send status to the data stream
        dataStream.writeData({
          type: "directory-listing",
          content: JSON.stringify({
            path: subPath || "/",
            files: jsonCompatibleFiles,
          }),
        });

        return {
          path: subPath || "/",
          files: fileData,
        };
      } catch (error) {
        console.error(`Error listing directory:`, error);
        return {
          path: subPath || "/",
          files: [],
          error: `Failed to list directory: ${(error as Error).message}`,
        };
      }
    },
  });
