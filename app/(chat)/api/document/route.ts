import {
  saveDocument,
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
} from "@/app/(chat)/actions";
import { ArtifactKind } from "@/components/artifact";
import { Document } from "@/lib/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const documents: Document[] = await getDocumentsById({ id });

  if (documents.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  return Response.json(documents, { status: 200 });
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const chatId = searchParams.get("chatId");

  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  if (!chatId) {
    return new Response("Missing chatId", { status: 400 });
  }

  const {
    content,
    title,
    kind,
  }: { content: string; title: string; kind: ArtifactKind } =
    await request.json();

  const document = await saveDocument({
    id,
    content,
    title,
    kind,
    chatId,
  });

  return Response.json(document, { status: 200 });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  const { timestamp }: { timestamp: string } = await request.json();

  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  await deleteDocumentsByIdAfterTimestamp({
    id,
    timestamp: new Date(timestamp),
  });

  return new Response("Deleted", { status: 200 });
}
