import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import { getValidatedPath } from "@/lib/utils";
import { DataStreamWriter, tool } from "ai";
import { createTwoFilesPatch } from "diff";
import path from "path";

// Schema Definition
const EditOperationSchema = z.object({
  oldText: z
    .string()
    .describe("Text to search for - must match exactly line by line."),
  newText: z.string().describe("Text to replace the oldText with."),
});

const editFileSchema = z.object({
  path: z
    .string()
    .describe(
      "Relative path of the file to edit within the chat's uploads directory."
    ),
  edits: z
    .array(EditOperationSchema)
    .describe("An array of edit operations to perform sequentially."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, return the diff without writing changes to the file."),
});

type EditFileParams = z.infer<typeof editFileSchema>;

// Result Type Definition
export interface EditFileResult {
  message: string; // Confirmation message or error
  oldContent?: string; // Original content before edits
  newContent?: string; // Content after edits (or original if error/dry run)
  error?: string; // Error message if failed
  extension?: string; // File extension
}

// Utility Functions (from reference)
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

async function applyFileEdits(
  filePath: string,
  edits: Array<{ oldText: string; newText: string }>,
  dryRun = false
): Promise<{ oldContent: string; newContent: string; error?: string }> {
  let content;
  try {
    content = normalizeLineEndings(await readFile(filePath, "utf-8"));
  } catch (readError: any) {
    return {
      oldContent: "", // Indicate read failure
      newContent: "",
      error: `Error reading file for edit: ${readError.message}`,
    };
  }

  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    // Find the start index of the exact multi-line block
    const startIndex = modifiedContent.indexOf(normalizedOld);

    if (startIndex === -1) {
      // Could add more sophisticated line-by-line matching here if needed
      return {
        oldContent: content,
        newContent: content, // Return original content on error
        error: `Could not find exact match for edit block:
--- Start Old Text ---
${edit.oldText}
--- End Old Text ---`,
      };
    }

    // Replace the block
    modifiedContent =
      modifiedContent.substring(0, startIndex) +
      normalizedNew +
      modifiedContent.substring(startIndex + normalizedOld.length);
  }

  if (!dryRun) {
    try {
      await writeFile(filePath, modifiedContent, "utf-8");
    } catch (writeError: any) {
      return {
        oldContent: content,
        newContent: modifiedContent, // Return modified content even if write fails
        error: `Error writing changes to file: ${writeError.message}`,
      };
    }
  }

  return { oldContent: content, newContent: modifiedContent };
}

// Tool Factory Function
export const editFile = ({
  dataStream,
  chatId,
}: {
  dataStream: DataStreamWriter;
  chatId: string;
}) =>
  tool({
    description:
      "Edit a text file by replacing specific blocks of text. Provide the exact text block to find (oldText) and the text to replace it with (newText). Handles multi-line replacements. Returns the original and modified content for comparison, along with the file extension. Use the dryRun option to preview changes without saving.",
    parameters: editFileSchema,
    execute: async ({
      path: relativePath,
      edits,
      dryRun,
    }: EditFileParams): Promise<EditFileResult> => {
      dataStream.writeData({
        type: "edit-file-start",
        content: {
          status: "started",
          path: relativePath,
          editCount: edits.length,
          dryRun,
        },
      });

      const validatedFilePath = getValidatedPath(chatId, relativePath);

      if (!validatedFilePath) {
        const errorMsg = "Invalid or unsafe file path specified.";
        dataStream.writeData({
          type: "edit-file-error",
          content: { path: relativePath, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
        };
      }

      try {
        const {
          oldContent,
          newContent,
          error: applyError,
        } = await applyFileEdits(validatedFilePath, edits, dryRun);

        if (applyError) {
          dataStream.writeData({
            type: "edit-file-error",
            content: { path: relativePath, error: applyError },
          });
          return {
            message: `Failed to apply edits: ${applyError}`,
            error: applyError,
            oldContent: oldContent,
            newContent: newContent, // Return content even on error
          };
        }

        const successMessage = dryRun
          ? `Successfully generated changes for ${relativePath} (dry run).`
          : `Successfully applied ${edits.length} edit(s) to ${relativePath}.`;

        // Extract file extension
        const extension = path.extname(validatedFilePath).slice(1);

        // Optionally stream the diff for intermediate UI update?
        const diffString = createTwoFilesPatch(
          validatedFilePath,
          validatedFilePath,
          oldContent,
          newContent,
          "original",
          "modified"
        );

        dataStream.writeData({
          type: "edit-file-complete",
          content: {
            status: "completed",
            path: relativePath,
            dryRun,
            diff: diffString, // Send diff via stream if needed
          },
        });

        return {
          message: successMessage,
          oldContent: oldContent,
          newContent: newContent,
          extension: extension,
        };
      } catch (error: any) {
        // Catch unexpected errors during the process
        const errorMsg = `Unexpected error editing file ${relativePath}: ${error.message}`;
        console.error(`Error in editFile tool for '${relativePath}':`, error);
        dataStream.writeData({
          type: "edit-file-error",
          content: { path: relativePath, error: errorMsg },
        });
        return {
          message: errorMsg,
          error: errorMsg,
        };
      }
    },
  });
