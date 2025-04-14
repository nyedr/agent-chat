import { z } from "zod";
import { DataStreamWriter, tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { document as documentSchema } from "@/lib/db/schema";
import {
  getDocumentsById,
  createNewDocumentVersion,
} from "@/app/(chat)/actions";
import { ArtifactKind } from "@/components/artifact";

const editSchema = z.object({
  oldText: z
    .string()
    .describe(
      "Text to search for. Tries exact match, then line-trimmed match, then block-anchor match."
    ),
  newText: z.string().describe("Text to replace the oldText with."),
});

const editDocumentSchema = z.object({
  documentId: z
    .string()
    .uuid()
    .describe("The UUID of the document artifact to edit."),
  edits: z
    .array(editSchema)
    .describe("An array of edit operations to perform sequentially."),
});

type EditDocumentParams = z.infer<typeof editDocumentSchema>;

export interface EditDocumentResult {
  message: string;
  documentId: string;
  oldContent?: string;
  newContent?: string;
  error?: string;
  extension?: string;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

// --- Start: Fallback Matching Logic ---

/**
 * Attempts a line-trimmed fallback match.
 * Returns [matchIndexStart, matchIndexEnd] or false.
 */
function lineTrimmedFallbackMatch(
  originalContent: string,
  searchContent: string
): [number, number] | false {
  const originalLines = normalizeLineEndings(originalContent).split("\n");
  const searchLines = normalizeLineEndings(searchContent).split("\n");

  if (searchLines.length === 0) return false;

  // Trim trailing empty line often caused by splitting
  if (searchLines[searchLines.length - 1].trim() === "") {
    searchLines.pop();
  }
  if (searchLines.length === 0) return false; // Handle case where search was just whitespace

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true;
    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim();
      const searchTrimmed = searchLines[j].trim();

      // Allow empty lines to match regardless of original whitespace
      if (searchTrimmed === "" && originalTrimmed === "") continue;

      if (originalTrimmed !== searchTrimmed) {
        matches = false;
        break;
      }
    }

    if (matches) {
      let matchStartIndex = 0;
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1; // +1 for \n
      }

      let matchEndIndex = matchStartIndex;
      for (let k = 0; k < searchLines.length; k++) {
        // Use the length of the *original* line for end index calc
        matchEndIndex += originalLines[i + k].length + 1; // +1 for \n
      }
      // Adjust end index because the last +1 added one too many newline chars
      matchEndIndex -= 1;

      return [matchStartIndex, matchEndIndex];
    }
  }

  return false;
}

/**
 * Attempts to match blocks using first/last lines as anchors.
 * Returns [matchIndexStart, matchIndexEnd] or false.
 */
function blockAnchorFallbackMatch(
  originalContent: string,
  searchContent: string
): [number, number] | false {
  const originalLines = normalizeLineEndings(originalContent).split("\n");
  const searchLines = normalizeLineEndings(searchContent).split("\n");

  // Only use for blocks of 3+ lines
  if (searchLines.length < 3) {
    return false;
  }

  // Trim trailing empty line
  if (searchLines[searchLines.length - 1].trim() === "") {
    searchLines.pop();
  }
  if (searchLines.length < 3) return false;

  const firstLineSearch = searchLines[0].trim();
  const lastLineSearch = searchLines[searchLines.length - 1].trim();
  const searchBlockSize = searchLines.length;

  for (let i = 0; i <= originalLines.length - searchBlockSize; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue;
    }

    if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
      continue;
    }

    // Calculate exact character positions for the matched block
    let matchStartIndex = 0;
    for (let k = 0; k < i; k++) {
      matchStartIndex += originalLines[k].length + 1; // +1 for \n
    }

    let matchEndIndex = matchStartIndex;
    for (let k = 0; k < searchBlockSize; k++) {
      matchEndIndex += originalLines[i + k].length + 1; // +1 for \n
    }
    // Adjust end index
    matchEndIndex -= 1;

    return [matchStartIndex, matchEndIndex];
  }

  return false;
}

// --- End: Fallback Matching Logic ---

export const editDocument = ({
  dataStream,
}: {
  dataStream: DataStreamWriter;
}) =>
  tool({
    description:
      "Edit an existing document artifact by replacing specific blocks of text. Provide the documentId and an array of edits. Each edit specifies text to find (oldText) and replacement text (newText). Tries exact match first, then line-by-line trimmed match, then first/last line anchor match. Preserves indentation. Saves changes and returns original/modified content.",
    parameters: editDocumentSchema,
    execute: async ({
      documentId,
      edits,
    }: EditDocumentParams): Promise<EditDocumentResult> => {
      dataStream.writeData({
        type: "edit-document-start",
        content: { status: "started", documentId, editCount: edits.length },
      });

      let oldContent: string | undefined = undefined;
      let modifiedContent: string | undefined = undefined;
      let currentDocument: typeof documentSchema.$inferSelect | undefined =
        undefined;

      try {
        const documents = await getDocumentsById({ id: documentId });
        if (!documents || documents.length === 0 || !documents[0]) {
          throw new Error(`Document with ID ${documentId} not found.`);
        }
        currentDocument = documents[0];

        if (currentDocument.content === null) {
          throw new Error(`Document with ID ${documentId} has no content.`);
        }

        oldContent = currentDocument.content;
        modifiedContent = normalizeLineEndings(oldContent);
        let applyError: string | undefined = undefined;

        // Apply edits sequentially
        for (const edit of edits) {
          const normalizedOld: string = normalizeLineEndings(edit.oldText);
          const normalizedNew: string = normalizeLineEndings(edit.newText);
          let matchResult: [number, number] | false = false;
          let matchType = "none";

          // 1. Try Exact Match
          const exactIndex: number = modifiedContent.indexOf(normalizedOld);
          if (exactIndex !== -1) {
            matchResult = [exactIndex, exactIndex + normalizedOld.length];
            matchType = "exact";
          } else {
            // 2. Try Line-Trimmed Match
            matchResult = lineTrimmedFallbackMatch(
              modifiedContent,
              normalizedOld
            );
            if (matchResult) {
              matchType = "line-trimmed";
            } else {
              // 3. Try Block Anchor Match
              matchResult = blockAnchorFallbackMatch(
                modifiedContent,
                normalizedOld
              );
              if (matchResult) {
                matchType = "block-anchor";
              }
            }
          }

          if (matchResult) {
            const [startIndex, endIndex]: [number, number] = matchResult;
            const originalBlock: string = modifiedContent.slice(
              startIndex,
              endIndex
            );
            const originalBlockLines: string[] = originalBlock.split("\n");
            const firstLineIndent: string =
              originalBlockLines[0]?.match(/^\s*/)?.[0] || "";

            // Apply indentation preservation to new text
            const newLinesWithIndent: string[] = normalizedNew
              .split("\n")
              .map((line): string => {
                // Preserve first line's indent for all new lines (simple approach)
                return firstLineIndent + line.trimStart();
              });
            const indentedNewText: string = newLinesWithIndent.join("\n");

            // Replace content
            modifiedContent =
              modifiedContent.slice(0, startIndex) +
              indentedNewText +
              modifiedContent.slice(endIndex);
          } else {
            applyError = `Could not find match for edit block (tried exact, line-trimmed, block-anchor):
--- Start Old Text ---
${edit.oldText}
--- End Old Text ---`;
            break; // Stop applying further edits if one fails
          }
        }

        // Handle errors
        if (applyError) {
          dataStream.writeData({
            type: "edit-document-error",
            content: { documentId, error: applyError },
          });
          return {
            documentId,
            message: `Failed to apply edits: ${applyError}`,
            error: applyError,
            oldContent: oldContent, // Return original fetched content
            newContent: oldContent, // Return original on error
            extension: currentDocument.extension,
          };
        }

        // --- Create New Version using Action --- //
        // Only save if edits were successful and content changed
        if (modifiedContent !== normalizeLineEndings(oldContent)) {
          // Call the dedicated createNewDocumentVersion action
          await createNewDocumentVersion({
            id: documentId,
            title: currentDocument.title, // Pass title from fetched doc
            kind: currentDocument.kind as ArtifactKind, // Pass kind from fetched doc
            content: modifiedContent, // Pass the new content
          });
        }

        const successMessage = `Successfully applied ${edits.length} edit(s) to ${currentDocument.title} (new version created).`;

        // --- Generate Diff & Finish --- //
        const diffString = createTwoFilesPatch(
          `${documentId}-original`,
          `${documentId}-modified`,
          oldContent, // Use original fetched content
          modifiedContent, // Use the final modified content
          "original",
          "modified"
        );

        dataStream.writeData({
          type: "edit-document-complete",
          content: {
            status: "completed",
            documentId,
            diff: diffString,
          },
        });

        return {
          documentId,
          message: successMessage,
          oldContent: oldContent,
          newContent: modifiedContent,
          extension: currentDocument.extension, // Pass extension back for UI
        };
      } catch (error: any) {
        const errorMsg = `Error editing document ${documentId}: ${error.message}`;
        console.error(
          `Error in editDocument tool for ID '${documentId}':`,
          error
        );
        dataStream.writeData({
          type: "edit-document-error",
          content: { documentId, error: errorMsg },
        });
        // Return old content if fetched, otherwise undefined
        return {
          documentId,
          message: errorMsg,
          error: errorMsg,
          oldContent: oldContent, // Might be undefined if DB fetch failed
          newContent: oldContent, // Return original if available
        };
      }
    },
  });
