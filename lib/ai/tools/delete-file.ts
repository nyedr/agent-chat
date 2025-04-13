import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { UPLOADS_DIR } from "@/lib/utils";

interface DeleteFileProps {
  dataStream: DataStreamWriter;
  chatId?: string;
}

export interface DeleteFileToolResult {
  success: boolean;
  path?: string;
  message: string;
  error?: string;
}

export const deleteFile = ({ dataStream, chatId }: DeleteFileProps) =>
  tool({
    description:
      "Deletes a specified file or directory within the chat's uploads directory.",
    parameters: z.object({
      path: z
        .string()
        .describe(
          "Relative path of the file or directory to delete within the chat's uploads directory."
        ),
    }),
    execute: async ({ path: filePath }): Promise<DeleteFileToolResult> => {
      if (!chatId) {
        return {
          success: false,
          message: "File deletion failed",
          error: "Chat ID is required to delete files",
        };
      }

      // Sanitize the path to prevent directory traversal
      const sanitizedPath = path
        .normalize(filePath)
        .replace(/^(\.\.(\/|\\|$))+/, "");

      if (!sanitizedPath) {
        return {
          success: false,
          path: filePath,
          message: "File deletion failed",
          error: "Invalid or empty path provided",
        };
      }

      const targetPath = path.join(UPLOADS_DIR, chatId, sanitizedPath);

      try {
        // Check if file/directory exists
        const stat = await fs.stat(targetPath).catch(() => null);
        if (!stat) {
          return {
            success: false,
            path: filePath,
            message: "File deletion failed",
            error: `File or directory does not exist: ${filePath}`,
          };
        }

        // Different handling for files and directories
        if (stat.isDirectory()) {
          await fs.rm(targetPath, { recursive: true, force: true });
          dataStream.writeData({
            type: "file-deleted",
            content: JSON.stringify({
              path: filePath,
              type: "directory",
              message: `Directory ${filePath} has been deleted`,
            }),
          });

          return {
            success: true,
            path: filePath,
            message: `Directory "${filePath}" has been deleted successfully`,
          };
        } else {
          await fs.unlink(targetPath);
          dataStream.writeData({
            type: "file-deleted",
            content: JSON.stringify({
              path: filePath,
              type: "file",
              message: `File ${filePath} has been deleted`,
            }),
          });

          return {
            success: true,
            path: filePath,
            message: `File "${filePath}" has been deleted successfully`,
          };
        }
      } catch (error) {
        console.error(`Error deleting file/directory:`, error);
        return {
          success: false,
          path: filePath,
          message: "File deletion failed",
          error: `Failed to delete: ${(error as Error).message}`,
        };
      }
    },
  });
