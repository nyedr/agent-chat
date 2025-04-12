import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getValidatedPath } from "@/lib/utils";
import { DataStreamWriter, tool } from "ai";
import { ArtifactKind } from "@/components/artifact";

const fileWriteSchema = z.object({
  file: z
    .string()
    .describe(
      "Relative path of the file to write to within the chat's uploads directory."
    ),
  title: z
    .string()
    .optional()
    .describe("(Optional) Title for the file preview."),
  content: z.string().describe("Text content to write to the file."),
  append: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "(Optional) Set to true to append content instead of overwriting."
    ),
  leading_newline: z
    .boolean()
    .optional()
    .default(false)
    .describe("(Optional) Add a newline character before the content."),
  trailing_newline: z
    .boolean()
    .optional()
    .default(false)
    .describe("(Optional) Add a newline character after the content."),
});

type FileWriteParams = z.infer<typeof fileWriteSchema>;

export type FileWriteResult = {
  message: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  file_path?: string;
  error?: string;
};

export const fileWrite = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId: string;
}) =>
  tool({
    description:
      "Overwrite or append text content to a file in the chat's uploads directory. Use for creating new files, saving text output, appending to logs, or modifying existing text-based files. Returns the file content for preview.",
    parameters: fileWriteSchema,
    execute: async ({
      file,
      title,
      content,
      append,
      leading_newline,
      trailing_newline,
    }: FileWriteParams): Promise<FileWriteResult> => {
      const validatedFilePath = getValidatedPath(chatId, file);

      if (!validatedFilePath) {
        const errorMsg = "Invalid or unsafe file path specified.";
        dataStream.writeData({
          type: "file-write-error",
          content: { file, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
          title: title || file,
          kind: "text",
          content: "",
        };
      }

      dataStream.writeData({
        type: "file-write-start",
        content: {
          status: "started",
          file,
          mode: append ? "append" : "overwrite",
        },
      });

      let contentToWrite = content;
      if (leading_newline) {
        contentToWrite = "\n" + contentToWrite;
      }
      if (trailing_newline) {
        contentToWrite = contentToWrite + "\n";
      }

      try {
        const dirPath = path.dirname(validatedFilePath);
        await mkdir(dirPath, { recursive: true });

        const writeOptions = { flag: append ? "a" : "w" };

        await writeFile(validatedFilePath, contentToWrite, writeOptions);

        const sanitizedRelativePath = file
          .replace(/^\/+/, "")
          .replace(/\/$/, "")
          .replace(/\.\.\//g, "");

        if (!sanitizedRelativePath) {
          throw new Error(
            "Failed to create a valid relative path after sanitization."
          );
        }

        const derivedTitle = title || sanitizedRelativePath;
        const relativeUrlPath = `/api/uploads/${chatId}/${sanitizedRelativePath}`;

        dataStream.writeData({
          type: "file-write-complete",
          content: {
            status: "completed",
            file: sanitizedRelativePath,
            title: derivedTitle,
            kind: "text",
            content: contentToWrite,
            file_path: relativeUrlPath,
          },
        });

        return {
          message: `Successfully wrote to file: ${sanitizedRelativePath}`,
          title: derivedTitle,
          kind: "text",
          content: contentToWrite,
          file_path: relativeUrlPath,
        };
      } catch (error: any) {
        let errorMsg = `Failed to write file: ${file}.`;
        if (error.code === "EACCES") {
          errorMsg = `Permission denied writing file: ${file}`;
        } else if (error.code === "EISDIR") {
          errorMsg = `Cannot write to a directory: ${file}`;
        } else {
          errorMsg = `Failed to write file: ${file}. ${error.message}`;
          console.error(`Error writing file '${validatedFilePath}':`, error);
        }
        dataStream.writeData({
          type: "file-write-error",
          content: { file, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
          title: title || file,
          kind: "text",
          content: "",
        };
      }
    },
  });
