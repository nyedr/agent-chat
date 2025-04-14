import { z } from "zod";
import { DataStreamWriter, tool } from "ai";
import { getDb } from "@/lib/db/init";
import {
  document as documentSchema,
  Document as DbDocument,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const readDocumentSchema = z.object({
  documentId: z
    .string()
    .uuid()
    .describe("The UUID of the document artifact to read."),
});

type ReadDocumentParams = z.infer<typeof readDocumentSchema>;

export interface ReadDocumentResult {
  documentId: string;
  title: string;
  kind: DbDocument["kind"];
  content: string | null;
  createdAt: string;
  error?: string;
}

export const readDocument = ({
  dataStream,
}: {
  dataStream: DataStreamWriter;
}) =>
  tool({
    description:
      "Reads the full content and metadata of an existing document artifact from the database using its ID.",
    parameters: readDocumentSchema,
    execute: async ({
      documentId,
    }: ReadDocumentParams): Promise<ReadDocumentResult> => {
      dataStream.writeData({
        type: "read-document-start",
        content: { status: "started", documentId },
      });

      try {
        const db = await getDb();
        const doc = await db
          .select()
          .from(documentSchema)
          .where(eq(documentSchema.id, documentId))
          .get();

        if (!doc) {
          throw new Error(`Document with ID ${documentId} not found.`);
        }

        dataStream.writeData({
          type: "read-document-complete",
          content: { status: "completed", documentId },
        });

        return {
          documentId: doc.id,
          title: doc.title,
          kind: doc.kind,
          content: doc.content,
          createdAt: doc.createdAt,
        };
      } catch (error: any) {
        const errorMsg = `Error reading document ${documentId}: ${error.message}`;
        console.error(errorMsg, error);
        dataStream.writeData({
          type: "read-document-error",
          content: { documentId, error: errorMsg },
        });
        return {
          documentId,
          title: "Error",
          kind: "text", // Default kind on error
          content: null,
          createdAt: new Date().toISOString(),
          error: errorMsg,
        };
      }
    },
  });
