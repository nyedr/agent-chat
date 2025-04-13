import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { UPLOADS_DIR } from "@/lib/utils";

interface MoveOrRenameFileProps {
  dataStream: DataStreamWriter;
  chatId?: string;
}

export interface MoveOrRenameFileToolResult {
  success: boolean;
  sourcePath?: string;
  destinationPath?: string;
  message: string;
  error?: string;
}

export const moveOrRenameFile = ({
  dataStream,
  chatId,
}: MoveOrRenameFileProps) =>
  tool({
    description:
      "Moves or renames a file or directory within the chat's uploads directory.",
    parameters: z.object({
      sourcePath: z
        .string()
        .describe(
          "Relative path of the source file or directory to move/rename within the chat's uploads directory."
        ),
      destinationPath: z
        .string()
        .describe(
          "Relative path of the destination location within the chat's uploads directory."
        ),
    }),
    execute: async ({
      sourcePath,
      destinationPath,
    }): Promise<MoveOrRenameFileToolResult> => {
      if (!chatId) {
        return {
          success: false,
          message: "File operation failed",
          error: "Chat ID is required to move or rename files",
        };
      }

      // Sanitize the paths to prevent directory traversal
      const sanitizedSourcePath = path
        .normalize(sourcePath)
        .replace(/^(\.\.(\/|\\|$))+/, "");

      const sanitizedDestPath = path
        .normalize(destinationPath)
        .replace(/^(\.\.(\/|\\|$))+/, "");

      if (!sanitizedSourcePath || !sanitizedDestPath) {
        return {
          success: false,
          sourcePath,
          destinationPath,
          message: "File operation failed",
          error: "Invalid or empty path provided",
        };
      }

      const sourceFullPath = path.join(
        UPLOADS_DIR,
        chatId,
        sanitizedSourcePath
      );
      const destFullPath = path.join(UPLOADS_DIR, chatId, sanitizedDestPath);

      try {
        // Check if source exists
        const sourceStat = await fs.stat(sourceFullPath).catch(() => null);
        if (!sourceStat) {
          return {
            success: false,
            sourcePath,
            destinationPath,
            message: "File operation failed",
            error: `Source file or directory does not exist: ${sourcePath}`,
          };
        }

        // Check if destination parent directory exists
        const destDirPath = path.dirname(destFullPath);
        const destDirStat = await fs.stat(destDirPath).catch(() => null);

        // Create destination directory if it doesn't exist
        if (!destDirStat) {
          await fs.mkdir(destDirPath, { recursive: true });
        } else if (!destDirStat.isDirectory()) {
          return {
            success: false,
            sourcePath,
            destinationPath,
            message: "File operation failed",
            error: `Destination parent path is not a directory: ${path.dirname(
              destinationPath
            )}`,
          };
        }

        // Check if destination already exists
        const destStat = await fs.stat(destFullPath).catch(() => null);
        if (destStat) {
          return {
            success: false,
            sourcePath,
            destinationPath,
            message: "File operation failed",
            error: `Destination already exists: ${destinationPath}`,
          };
        }

        // Perform the move/rename operation
        await fs.rename(sourceFullPath, destFullPath);

        const fileType = sourceStat.isDirectory() ? "directory" : "file";

        dataStream.writeData({
          type: "file-moved",
          content: JSON.stringify({
            sourcePath,
            destinationPath,
            type: fileType,
            message: `${
              fileType === "directory" ? "Directory" : "File"
            } ${sourcePath} has been moved to ${destinationPath}`,
          }),
        });

        return {
          success: true,
          sourcePath,
          destinationPath,
          message: `${
            fileType === "directory" ? "Directory" : "File"
          } "${sourcePath}" has been moved to "${destinationPath}" successfully`,
        };
      } catch (error) {
        console.error(`Error moving/renaming file/directory:`, error);
        return {
          success: false,
          sourcePath,
          destinationPath,
          message: "File operation failed",
          error: `Failed to move or rename: ${(error as Error).message}`,
        };
      }
    },
  });
