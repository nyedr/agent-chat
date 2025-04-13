import { createDocumentHandler } from "@/lib/artifacts/server";
import { DataStreamWriter, streamText } from "ai";
import { DEFAULT_MODEL_NAME, myProvider } from "@/lib/ai/models";
import { htmlPrompt, updateDocumentPrompt } from "@/lib/ai/prompts";

const initialHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Document</title>
    <style>
        body { font-family: sans-serif; padding: 1rem; }
    </style>
</head>
<body>
    <h1>Welcome</h1>
    <p>This is a new HTML document.</p>
</body>
</html>`;

export const htmlDocumentHandler = createDocumentHandler({
  kind: "html",
  onCreateDocument: async ({ title, dataStream }) => {
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

        dataStream.writeMessageAnnotation({
          type: "html-delta",
          content: textDelta,
        });
      }
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

        dataStream.writeMessageAnnotation({
          type: "html-delta",
          content: textDelta,
        });
      }
    }

    return draftContent;
  },
});
