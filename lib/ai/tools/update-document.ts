import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { getDocumentById } from "@/app/(chat)/actions";
import { documentHandlersByArtifactKind } from "@/lib/artifacts/server";
import { ArtifactKind } from "@/components/artifact";

interface UpdateDocumentProps {
  dataStream: DataStreamWriter;
}

export interface UpdateDocumentToolResult {
  id: string;
  title?: string;
  kind?: ArtifactKind;
  content?: string;
  error?: string;
}

export const updateDocument = ({ dataStream }: UpdateDocumentProps) =>
  tool({
    description: "Update a document with the given description.",
    parameters: z.object({
      id: z.string().describe("The ID of the document to update"),
      description: z
        .string()
        .describe("The description of changes that need to be made"),
    }),
    execute: async ({ id, description }): Promise<UpdateDocumentToolResult> => {
      const document = await getDocumentById({ id });

      if (!document) {
        return {
          id,
          error: "Document not found",
        };
      }

      dataStream.writeData({
        type: "clear",
        content: document.title,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === document.kind
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${document.kind}`);
      }

      await documentHandler.onUpdateDocument({
        document,
        description,
        dataStream,
      });

      dataStream.writeData({ type: "finish", content: "" });

      return {
        id,
        title: document.title,
        kind: document.kind,
        content: "The document has been updated successfully.",
      };
    },
  });
