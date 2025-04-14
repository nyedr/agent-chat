import { z } from "zod";
import { DataStreamWriter, tool } from "ai";
import { generateUUID } from "@/lib/utils";
import {
  documentHandlersByArtifactKind,
  artifactKinds,
} from "@/lib/artifacts/server";
import { ArtifactKind } from "@/components/artifact";
import { saveDocument } from "@/app/(chat)/actions";

interface CreateDocumentProps {
  dataStream: DataStreamWriter;
  chatId: string;
}

export interface CreateDocumentToolResult {
  id: string;
  title: string;
  kind: string;
  extension: string;
  content: string;
}

const defaultExtensions: Record<ArtifactKind, string> = {
  text: "txt",
  code: "py",
  html: "html",
  image: "png",
  sheet: "csv",
};

export const createDocument = ({ dataStream, chatId }: CreateDocumentProps) =>
  tool({
    description:
      "Create a document artifact (text, Python code, or HTML) for writing or content creation activities. The artifact will appear in the panel, and its content will be generated based on the title and kind.",
    parameters: z.object({
      title: z.string().describe("A descriptive title for the artifact."),
      kind: z
        .enum(artifactKinds)
        .describe("The type of artifact: 'text', 'code' (Python), or 'html'."),
      extension: z
        .string()
        .optional()
        .describe(
          "Optional file extension (e.g., 'py', 'html', 'txt'). If not provided, a default based on 'kind' will be used."
        ),
    }),
    execute: async ({
      title,
      kind,
      extension,
    }: {
      title: string;
      kind: ArtifactKind;
      extension?: string;
    }): Promise<CreateDocumentToolResult> => {
      const id = generateUUID();
      const finalExtension = extension || defaultExtensions[kind] || "txt";

      try {
        await saveDocument({
          id,
          title,
          kind,
          content: "",
          chatId,
          extension: finalExtension,
        });
      } catch (saveError) {
        console.error("Initial save failed in createDocument:", saveError);
      }

      dataStream.writeData({
        type: "kind",
        content: kind,
      });

      dataStream.writeData({
        type: "id",
        content: id,
      });

      dataStream.writeData({
        type: "title",
        content: title,
      });

      dataStream.writeData({
        type: "clear",
        content: "",
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (handler) => handler.kind === kind
      );

      if (!documentHandler) {
        dataStream.writeData({ type: "finish", content: "" });
        return {
          id,
          title,
          kind,
          extension: finalExtension,
          content: `Error: No document handler found for kind: ${kind}`,
        };
      }

      try {
        await documentHandler.onCreateDocument({
          id,
          title,
          dataStream,
          chatId,
        });
      } catch (handlerError) {
        const errorMsg = (handlerError as Error).message;
        console.error(
          `Error during document handler execution for ${kind}:`,
          handlerError
        );
        dataStream.writeData({
          type: "handler-error",
          content: { id, error: errorMsg },
        });
      }

      dataStream.writeData({ type: "finish", content: "" });

      return {
        id,
        title,
        kind,
        extension: finalExtension,
        content:
          "A document artifact was created and is now visible to the user.",
      };
    },
  });
