import {
  CoreMessage,
  type Message,
  appendResponseMessages,
  createDataStreamResponse,
  smoothStream,
  streamText,
} from "ai";
import { z } from "zod";
import { modelsByCapability, myProvider } from "@/lib/ai/models";
import { ToolName, createModelTools } from "@/lib/ai/tools";

import { systemPrompt } from "@/lib/ai/prompts";
import {
  addChatMessage,
  createNewChat,
  deleteByChatId,
  getAllChats,
  getChatById,
  updateChat,
} from "@/app/(chat)/actions";
import {
  generateUUID,
  getMostRecentUserMessage,
  UPLOADS_DIR,
} from "@/lib/utils";

import { extractMessageContext } from "@/lib/chat/context-extractor";
import path from "path";
import { rm } from "fs/promises";
import fs from "fs";

const deepResearchTools: ToolName[] = ["deepResearch"];

const allTools: ToolName[] = [
  ...deepResearchTools,
  "createDocument",
  "imageSearch",
  "videoSearch",
  "searchWeb",
  "scrapeUrl",
  "pythonInterpreter",
  "fileRead",
  // "extractStructuredData",
  "editDocument",
  "getFileInfo",
  "readDocument",
  "shellExec",
];

export async function POST(request: Request) {
  const {
    chatId,
    messages,
    modelId,
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
    experimental_context = false,
    isRetry = false,
  }: {
    chatId: string;
    messages: Array<Message>;
    modelId: string;
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
    experimental_context?: boolean;
    isRetry?: boolean;
  } = await request.json();

  const userMessage = getMostRecentUserMessage(messages);

  if (!userMessage) {
    return new Response("No user message found", { status: 400 });
  }

  const {
    data: chatData,
    documents: chatDocuments,
    uploadedFiles,
    error: chatError,
  } = await getChatById({ id: chatId });

  if (chatError || !chatData || !chatData.chat) {
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
  } else {
    console.log(
      `Fetched chat ${chatId}, ${chatDocuments.length} docs, ${uploadedFiles.length} uploads.`
    );
  }

  const currentDocuments = chatDocuments || [];
  const currentUploadedFiles = uploadedFiles || [];

  const validMessages = messages
    .with(-1, userMessage)
    .map(({ parts, ...rest }: any) => {
      return {
        content: rest.content,
        role: rest.role,
        experimental_attachments: rest.experimental_attachments,
      };
    }) satisfies CoreMessage[];

  console.log("validMessages:", validMessages);

  if (!isRetry) {
    await addChatMessage({
      chatId,
      message: userMessage,
    });
  }

  const extractedContextFromUserMessage = experimental_context
    ? await extractMessageContext(userMessage.content)
    : null;

  return createDataStreamResponse({
    execute: (dataStream) => {
      const tools = createModelTools({
        dataStream,
        chatId,
        models: {
          deepResearch: modelsByCapability.deepResearch,
        },
        usePreScrapingRerank,
        maxFinalResults,
      });

      const result = streamText({
        model: myProvider.chatModel(modelId),
        system: systemPrompt({
          tools: experimental_deepResearch ? deepResearchTools : allTools,
          documents: currentDocuments,
          uploadedFiles: currentUploadedFiles,
          context: extractedContextFromUserMessage?.context,
          currentDate: new Date().toISOString(),
        }),
        providerOptions: {
          openrouter: {
            exclude: false,
          },
        },
        messages: validMessages,
        maxSteps: 15,
        experimental_transform: smoothStream({ chunking: "word" }),
        experimental_generateMessageId: generateUUID,
        experimental_activeTools: experimental_deepResearch
          ? deepResearchTools
          : allTools,
        tools,
        onFinish: async ({ response }) => {
          try {
            const assistantMessageId = response.messages
              .filter((message) => message.role === "assistant")
              .at(-1)?.id;

            if (!assistantMessageId) {
              throw new Error("No assistant message found!");
            }

            const [, assistantMessage] = appendResponseMessages({
              messages: [userMessage],
              responseMessages: response.messages,
            });

            console.log("assistantMessage:", assistantMessage);

            await addChatMessage({
              chatId,
              message: assistantMessage,
              isRetry,
            });
          } catch (error) {
            console.error("Failed to save chat", error);
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

      result.consumeStream();

      result.mergeIntoDataStream(dataStream, {
        sendReasoning: true,
      });
    },
    onError: (error) => {
      console.error("Error in chat:", error);
      return "An error occurred while processing your request";
    },
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ error: "No ID provided" }, { status: 400 });
  }

  // Call the renamed function which handles document and chat deletion
  try {
    await deleteByChatId(id);
    console.log(`Successfully deleted DB records for chat ${id}.`);

    // Delete uploads directory from filesystem *after* successful DB deletion
    const uploadDirPath = path.join(UPLOADS_DIR, id);
    try {
      if (fs.existsSync(uploadDirPath)) {
        await rm(uploadDirPath, { recursive: true, force: true });
        console.log(`Deleted uploads directory: ${uploadDirPath}`);
      } else {
        console.log(
          `Uploads directory not found, skipping deletion: ${uploadDirPath}`
        );
      }
    } catch (fsError) {
      console.error(
        `Error deleting uploads directory ${uploadDirPath}:`,
        fsError
      );
      // Log error but still return success as DB records are deleted
    }

    return Response.json({
      success: true,
      message: "Chat and associated data deleted",
    });
  } catch (error) {
    console.error(`Error in DELETE route for chat ID ${id}:`, error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete chat";
    return Response.json({ error: errorMessage }, { status: 500 });
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
