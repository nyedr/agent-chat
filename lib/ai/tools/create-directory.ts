import { z } from "zod";
import { mkdir } from "fs/promises";
import { getValidatedPath } from "@/lib/utils";
import { DataStreamWriter, tool } from "ai";

// Schema Definition
const createDirectorySchema = z.object({
  path: z
    .string()
    .describe(
      "Relative path for the directory to create within the chat's uploads directory. Can include nested paths."
    ),
});

type CreateDirectoryParams = z.infer<typeof createDirectorySchema>;

// Result Type Definition
export interface CreateDirectoryResult {
  message: string; // Confirmation or error message
  path: string; // The path that was processed
  error?: string; // Error message if failed
}

// Tool Factory Function
export const createDirectory = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId: string;
}) =>
  tool({
    description:
      "Create a new directory (and any necessary parent directories) within the chat's secure upload directory. If the directory already exists, it succeeds silently.",
    parameters: createDirectorySchema,
    execute: async ({
      path,
    }: CreateDirectoryParams): Promise<CreateDirectoryResult> => {
      dataStream.writeData({
        type: "create-directory-start",
        content: { status: "started", path },
      });

      const validatedDirPath = getValidatedPath(chatId, path);

      if (!validatedDirPath) {
        const errorMsg = "Invalid or unsafe directory path specified.";
        dataStream.writeData({
          type: "create-directory-error",
          content: { path, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
          path: path,
        };
      }

      try {
        // mkdir with recursive: true handles nested paths and existing directories
        await mkdir(validatedDirPath, { recursive: true });

        const successMessage = `Successfully created or ensured directory exists: ${path}`;
        dataStream.writeData({
          type: "create-directory-complete",
          content: { status: "completed", path },
        });
        return {
          message: successMessage,
          path: path,
        };
      } catch (error: any) {
        const errorMsg = `Failed to create directory ${path}: ${error.message}`;
        console.error(`Error creating directory '${validatedDirPath}':`, error);
        dataStream.writeData({
          type: "create-directory-error",
          content: { path, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
          path: path,
        };
      }
    },
  });
