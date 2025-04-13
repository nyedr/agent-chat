import { z } from "zod";
import { stat } from "fs/promises";
import { getValidatedPath } from "@/lib/utils";
import { DataStreamWriter, tool } from "ai";

const getFileInfoSchema = z.object({
  path: z
    .string()
    .describe(
      "Relative path of the file or directory within the chat's uploads directory."
    ),
});

type GetFileInfoParams = z.infer<typeof getFileInfoSchema>;

interface FileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  createdAt: string;
  modifiedAt: string;
  permissions: string;
}

export interface GetFileInfoResult {
  info?: FileInfo;
  error?: string;
}

export const getFileInfo = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId: string;
}) =>
  tool({
    description:
      "Retrieve detailed metadata about a specific file or directory within the chat's uploads directory, including size, type, dates, and permissions.",
    parameters: getFileInfoSchema,
    execute: async ({
      path,
    }: GetFileInfoParams): Promise<GetFileInfoResult> => {
      dataStream.writeData({
        type: "get-file-info-start",
        content: { status: "started", path },
      });

      const validatedPath = getValidatedPath(chatId, path);

      if (!validatedPath) {
        const errorMsg = "Invalid or unsafe path specified.";
        dataStream.writeData({
          type: "get-file-info-error",
          content: { path, error: errorMsg },
        });
        return {
          error: errorMsg,
        };
      }

      try {
        const stats = await stat(validatedPath);
        const fileInfo: FileInfo = {
          name: validatedPath.split("/").pop() || path, // Get filename from path
          path: path, // Return the requested relative path
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
          modifiedAt: stats.mtime.toISOString(),
          permissions: stats.mode.toString(8).slice(-3), // Get octal permissions
        };

        dataStream.writeData({
          type: "get-file-info-complete",
          content: { status: "completed", path, info: { ...fileInfo } },
        });

        return {
          info: fileInfo,
        };
      } catch (error: any) {
        let errorMsg = `Failed to get info for ${path}.`;
        if (error.code === "ENOENT") {
          errorMsg = `Path not found: ${path}`;
        } else if (error.code === "EACCES") {
          errorMsg = `Permission denied accessing ${path}`;
        } else {
          errorMsg = `Failed to get info for ${path}: ${error.message}`;
          console.error(`Error getting info for '${validatedPath}':`, error);
        }
        dataStream.writeData({
          type: "get-file-info-error",
          content: { path, error: errorMsg },
        });
        return {
          error: errorMsg,
        };
      }
    },
  });
