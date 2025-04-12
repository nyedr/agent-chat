import { Chat } from "@/components/chat";
import { generateUUID } from "@/lib/utils";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { cookies } from "next/headers";
import { DEFAULT_MODEL_NAME } from "@/lib/ai/models";

export default async function Page() {
  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get("model-id")?.value;

  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        selectedModelId={modelIdFromCookie || DEFAULT_MODEL_NAME}
      />
      <DataStreamHandler id={id} />
    </>
  );
}
