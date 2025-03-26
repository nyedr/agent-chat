import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { Chat } from "@/components/chat";
import {
  DEFAULT_MODEL_NAME,
  DEFAULT_REASONING_MODEL_NAME,
} from "@/lib/ai/models";
import { getChatById } from "@/app/(chat)/actions";
import { convertToUIMessages, parseChatFromDB } from "@/lib/utils";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { Message } from "ai";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  if (!chat || !chat.data || !chat.data.chat) {
    notFound();
  }

  const { messages: messagesFromDb } = parseChatFromDB(chat.data.chat);

  const cookieStore = await cookies();

  const modelIdFromCookie = cookieStore.get("model-id")?.value;
  const reasoningModelIdFromCookie =
    cookieStore.get("reasoning-model-id")?.value;

  return (
    <>
      <Chat
        id={chat.data.id}
        initialMessages={convertToUIMessages(messagesFromDb)}
        selectedModelId={modelIdFromCookie || DEFAULT_MODEL_NAME}
        selectedReasoningModelId={
          reasoningModelIdFromCookie || DEFAULT_REASONING_MODEL_NAME
        }
      />
      <DataStreamHandler id={id} />
    </>
  );
}
