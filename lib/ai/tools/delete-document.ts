import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { getDb } from "@/lib/db/init";
import { document as documentSchema } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface DeleteDocumentProps {
  dataStream: DataStreamWriter;
  chatId?: string;
}

export interface DeleteDocumentToolResult {
  success: boolean;
  documentId?: string;
  message: string;
  error?: string;
}

export const deleteDocument = ({ dataStream }: DeleteDocumentProps) =>
  tool({
    description:
      "Deletes a specified document from the database using its unique ID.",
    parameters: z.object({
      documentId: z
        .string()
        .uuid()
        .describe(
          "The UUID of the document to delete. This should be a valid document ID stored in the database."
        ),
    }),
    execute: async ({ documentId }): Promise<DeleteDocumentToolResult> => {
      try {
        // Connect to database
        const db = await getDb();

        // Check if document exists first
        const existingDocument = await db
          .select({ id: documentSchema.id, title: documentSchema.title })
          .from(documentSchema)
          .where(eq(documentSchema.id, documentId))
          .get();

        if (!existingDocument) {
          return {
            success: false,
            documentId,
            message: "Document deletion failed",
            error: `Document with ID ${documentId} does not exist`,
          };
        }

        // Delete the document from the database
        await db
          .delete(documentSchema)
          .where(eq(documentSchema.id, documentId))
          .run();

        // Notify via dataStream
        dataStream.writeData({
          type: "document-deleted",
          content: JSON.stringify({
            documentId,
            title: existingDocument.title || "Untitled Document",
            message: `Document ${documentId} has been deleted`,
          }),
        });

        return {
          success: true,
          documentId,
          message: `Document "${
            existingDocument.title || "Untitled Document"
          }" has been deleted successfully`,
        };
      } catch (error) {
        console.error(`Error deleting document:`, error);
        return {
          success: false,
          documentId,
          message: "Document deletion failed",
          error: `Failed to delete document: ${(error as Error).message}`,
        };
      }
    },
  });
