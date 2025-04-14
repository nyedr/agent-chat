import { createDocumentHandler } from "@/lib/artifacts/server";
import { streamText } from "ai";
import { DEFAULT_MODEL_NAME, myProvider } from "@/lib/ai/models";
import { htmlPrompt, updateDocumentPrompt } from "@/lib/ai/prompts";
import { saveDocument } from "@/app/(chat)/actions";

export const htmlDocumentHandler = createDocumentHandler({
  kind: "html",
  onCreateDocument: async ({ id, title, dataStream }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: myProvider.chatModel(DEFAULT_MODEL_NAME),
      system: htmlPrompt,
      prompt: title,
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === "text-delta") {
        const { textDelta } = delta;

        draftContent += textDelta;

        dataStream.writeData({
          type: "html-delta",
          content: textDelta,
        });
      }
    }

    try {
      await saveDocument({
        id: id,
        title: title,
        kind: "html",
        content: draftContent,
      });
    } catch (error) {
      console.error("Error saving final HTML content:", error);
    }

    return draftContent;
  },
  onUpdateDocument: async ({ description, document, dataStream }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: myProvider.chatModel(DEFAULT_MODEL_NAME),
      system: updateDocumentPrompt(document.content ?? "", "html"),
      prompt: description,
    });

    for await (const delta of fullStream) {
      const { type } = delta;

      if (type === "text-delta") {
        const { textDelta } = delta;

        draftContent += textDelta;

        dataStream.writeData({
          type: "html-delta",
          content: textDelta,
        });
      }
    }

    try {
      await saveDocument({
        id: document.id,
        title: document.title,
        kind: "html",
        content: draftContent,
        extension: document.extension,
      });
    } catch (error) {
      console.error("Error saving updated HTML content:", error);
    }

    return draftContent;
  },
});
