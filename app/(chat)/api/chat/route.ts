import {
  type Message,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from "ai";
import { z } from "zod";
import { modelsByCapability, myProvider } from "@/lib/ai/models";
import { createDocument, deepResearch, updateDocument } from "@/lib/ai/tools";

import { systemPrompt } from "@/lib/ai/prompts";
import {
  addChatMessage,
  createNewChat,
  deleteChatById,
  deleteDocumentsByChatId,
  getAllChats,
  getChatById,
  getDocumentsByChatId,
  updateChat,
} from "@/app/(chat)/actions";
import {
  generateUUID,
  getMessageContent,
  getMostRecentUserMessage,
  sanitizeResponseMessages,
} from "@/lib/utils";

import { createSearchTools } from "@/lib/search/tools";

export type AllowedTools =
  | "deepResearch"
  | "search"
  | "createDocument"
  | "updateDocument"
  | "imageSearch"
  | "videoSearch";

const deepResearchTools: AllowedTools[] = ["deepResearch"];

const allTools: AllowedTools[] = [
  ...deepResearchTools,
  "createDocument",
  "updateDocument",
  "imageSearch",
  "videoSearch",
  "search",
];

export async function POST(request: Request) {
  const {
    chatId,
    messages,
    modelId,
    reasoningModelId,
    experimental_deepResearch = false,
    maxTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    seed,

    usePreScrapingRerank,
    maxFinalResults,
  }: {
    chatId: string;
    messages: Array<Message>;
    modelId: string;
    reasoningModelId: string;
    experimental_deepResearch?: boolean;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    seed?: number;
    usePreScrapingRerank?: boolean;
    maxFinalResults?: number;
  } = await request.json();

  const userMessage = getMostRecentUserMessage(messages);

  if (!userMessage) {
    return new Response("No user message found", { status: 400 });
  }

  console.log("userMessage:", userMessage);

  const chat = await getChatById({ id: chatId });

  if (!chat.data || chat.error !== null || !chat.data.chat) {
    console.log("Chat not found, creating new chat");
    // const title = await generateTitleFromUserMessage({ message: userMessage });

    const title =
      typeof userMessage.content === "string"
        ? userMessage.content
        : "New Chat";

    const newChat = await createNewChat({
      title,
      providedId: chatId,
    });

    if (!newChat.success) {
      return new Response("Failed to create new chat", { status: 500 });
    }
  }

  const validMessages = messages
    .with(-1, userMessage)
    .map(({ parts, ...rest }: any) => {
      return {
        content: getMessageContent(rest as Message),
        role: rest.role,
        id: rest.id,
        experimental_attachments: rest.experimental_attachments,
      };
    }) satisfies Message[];

  console.log("validMessages:", validMessages);

  await addChatMessage({
    chatId,
    message: userMessage,
  });

  const chatDocuments = await getDocumentsByChatId({
    chatId,
  });

  console.log("chatDocuments:", chatDocuments);

  return createDataStreamResponse({
    execute: (dataStream) => {
      dataStream.writeData({
        type: "user-message-id",
        content: userMessage.id,
      });

      const searchTools = createSearchTools({
        dataStream,
        usePreScrapingRerank,
        maxFinalResults,
      });

      const result = streamText({
        model: myProvider.chatModel(modelId),
        system: systemPrompt({
          tools: experimental_deepResearch ? deepResearchTools : allTools,
          documents: chatDocuments,
        }),
        messages: validMessages,
        maxSteps: 10,
        experimental_transform: smoothStream() as any,
        experimental_generateMessageId: generateUUID,
        experimental_activeTools: experimental_deepResearch
          ? deepResearchTools
          : allTools,
        tools: {
          createDocument: createDocument({
            dataStream,
            chatId,
          }),
          updateDocument: updateDocument({
            dataStream,
          }),
          search: searchTools.searchTool,
          imageSearch: searchTools.imageSearchTool,
          videoSearch: searchTools.videoSearchTool,
          deepResearch: deepResearch({
            dataStream,
            models: modelsByCapability.deepResearch,
          }),
        },
        onFinish: async ({ response }) => {
          try {
            const sanitizedResponseMessage = sanitizeResponseMessages(
              response.messages
            ) as Message;

            console.log("sanitizedResponseMessage:", sanitizedResponseMessage);

            const assistantMessageId = response.messages
              .filter((message) => message.role === "assistant")
              .at(-1)?.id;

            if (!assistantMessageId) {
              throw new Error("No assistant message found!");
            }

            if (sanitizedResponseMessage.role === "assistant") {
              dataStream.writeMessageAnnotation({
                messageIdFromServer: assistantMessageId,
              });
            }

            const responseMessage: Message = {
              createdAt: new Date(),
              content: getMessageContent(sanitizedResponseMessage),
              role: sanitizedResponseMessage.role,
              parts: sanitizedResponseMessage.parts,
              id: assistantMessageId,
              experimental_attachments:
                sanitizedResponseMessage.experimental_attachments,
            };

            console.log("responseMessage:", responseMessage);

            await addChatMessage({
              chatId,
              message: responseMessage,
            });
          } catch (error) {
            console.error("Failed to save chat");
          }
        },
        ...(maxTokens !== undefined && { maxTokens }),
        ...(temperature !== undefined && { temperature }),
        ...(topP !== undefined && { topP }),
        ...(topK !== undefined && { topK }),
        ...(presencePenalty !== undefined && { presencePenalty }),
        ...(frequencyPenalty !== undefined && { frequencyPenalty }),
        ...(seed !== undefined && { seed }),
      });

      result.mergeIntoDataStream(dataStream);
    },
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "No ID provided" }, { status: 400 });
  }

  await deleteDocumentsByChatId({ chatId: id });

  try {
    await deleteChatById(id);
    return Response.json({ success: true, message: "Chat deleted" });
  } catch (error) {
    console.error("Error deleting chat:", error);
    return Response.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const chats = await getAllChats();
    return Response.json({
      data: chats,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Failed to get chats", error);
    return Response.json({
      data: [],
      error: "An error occurred while processing your request",
      status: 500,
    });
  }
}

const chatUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  folder_id: z.string().nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("id");

    if (!chatId) {
      return Response.json({
        data: null,
        error: "Chat ID is required",
        status: 400,
      });
    }

    const result = chatUpdateSchema.safeParse(body);
    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    await updateChat({
      id: chatId,
      ...result.data,
    });

    const chat = await getChatById({ id: chatId });
    return Response.json({
      data: chat.data,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error in PUT /api/chat:", error);
    return Response.json({
      data: null,
      error: "Failed to update chat",
      status: 500,
    });
  }
}
