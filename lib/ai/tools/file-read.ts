import { z } from "zod";
import { readFile } from "fs/promises";
import { getValidatedPath } from "@/lib/utils";
import { DataStreamWriter, tool } from "ai";
import { ArtifactKind } from "@/components/artifact";

const fileReadSchema = z.object({
  file: z
    .string()
    .describe(
      "Relative path of the file to read within the chat's uploads directory."
    ),
  start_line: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("(Optional) Starting line to read from, 0-based."),
  end_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("(Optional) Ending line number (exclusive)."),
});

export interface FileReadResult {
  error?: string;
  title: string;
  kind: ArtifactKind;
  content: string;
}

export const fileRead = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId: string;
}) =>
  tool({
    description:
      "Read file content from the chat's uploads directory. Use for checking file contents, analyzing logs, or reading configuration files generated/uploaded previously in the chat.",
    parameters: fileReadSchema,
    execute: async ({
      file,
      end_line,
      start_line,
    }): Promise<FileReadResult> => {
      dataStream.writeData({
        type: "file-read-start",
        content: { status: "started", file },
      });

      const validatedFilePath = getValidatedPath(chatId, file);

      if (!validatedFilePath) {
        dataStream.writeData({
          type: "file-read-error",
          content: { file, error: "Invalid or unsafe file path specified." },
        });
        return {
          error: "Invalid or unsafe file path specified.",
          title: file,
          kind: "text",
          content: "",
        };
      }

      try {
        const content = await readFile(validatedFilePath, "utf-8");
        let lines = content.split("\n");

        // Handle potential trailing newline creating an empty last element
        if (lines.length > 0 && lines[lines.length - 1] === "") {
          lines.pop();
        }

        // Handle line slicing
        let slicedLines = lines;
        const actualStart =
          start_line !== undefined
            ? start_line < 0 // Negative index means count from end
              ? Math.max(0, lines.length + start_line)
              : Math.min(start_line, lines.length) // Clamp start to array bounds
            : 0; // Default start is 0

        const actualEnd =
          end_line !== undefined
            ? // end_line is exclusive, adjust negative index logic if needed
              end_line < 0
              ? lines.length + end_line // Slice works with negative end index
              : Math.min(end_line, lines.length) // Clamp end to array bounds
            : lines.length; // Default end is length

        if (actualStart >= lines.length) {
          // Start line is beyond the file content
          dataStream.writeData({
            type: "file-read-complete",
            content: { status: "completed", file, result: "" },
          });
          return {
            title: file,
            kind: "text",
            content: "",
          };
        }

        if (actualStart >= actualEnd) {
          const errorMsg = "Calculated start_line is not less than end_line.";
          dataStream.writeData({
            type: "file-read-error",
            content: { file, error: errorMsg },
          });
          return {
            error: errorMsg,
            title: file,
            kind: "text",
            content: "",
          };
        }

        if (start_line !== undefined || end_line !== undefined) {
          // Slice extracts from actualStart up to, but not including, actualEnd
          slicedLines = lines.slice(actualStart, actualEnd);
        }

        const resultText = slicedLines.join("\n");
        dataStream.writeData({
          type: "file-read-complete",
          content: { status: "completed", file, result: resultText }, // Optional: Include result in stream?
        });
        return {
          title: file,
          kind: "text",
          content: resultText,
        };
      } catch (error: any) {
        let errorMsg = `Failed to read file: ${file}.`;
        if (error.code === "ENOENT") {
          errorMsg = `File not found: ${file}`;
        } else if (error.code === "EACCES") {
          errorMsg = `Permission denied reading file: ${file}`;
        } else {
          errorMsg = `Failed to read file: ${file}. ${error.message}`;
          console.error(`Error reading file '${validatedFilePath}':`, error);
        }
        dataStream.writeData({
          type: "file-read-error",
          content: { file, error: errorMsg },
        });
        return {
          error: errorMsg,
          title: file,
          kind: "text",
          content: "",
        };
      }
    },
  });
