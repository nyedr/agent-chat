import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { join } from "path";
import { UPLOADS_DIR } from "@/lib/utils";
import { mkdir, writeFile } from "fs/promises";

// Supported file types and their MIME types
const SUPPORTED_FILE_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "application/json": [".json"],
} as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= MAX_FILE_SIZE, {
      message: `File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    })
    .refine((file) => Object.keys(SUPPORTED_FILE_TYPES).includes(file.type), {
      message: `File type must be one of: ${Object.keys(SUPPORTED_FILE_TYPES)
        .map(
          (type) =>
            SUPPORTED_FILE_TYPES[type as keyof typeof SUPPORTED_FILE_TYPES]
        )
        .flat()
        .join(", ")}`,
    }),
});

// Schema to validate chat ID
const ChatIdSchema = z.string().uuid("Invalid Chat ID format");

export async function POST(request: NextRequest) {
  console.log("Starting file upload process");

  if (request.body === null) {
    console.error("Upload failed: Request body is empty");
    return NextResponse.json(
      { error: "Request body is empty" },
      { status: 400 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob | null;
    const chatId = formData.get("chatId") as string | null;

    if (!file) {
      console.error("Upload failed: No file in request");
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!chatId) {
      console.error("Upload failed: No chatId provided");
      return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
    }

    // Validate chatId
    const validatedChatId = ChatIdSchema.safeParse(chatId);
    if (!validatedChatId.success) {
      console.error("Upload failed: Invalid chatId", validatedChatId.error);
      return NextResponse.json(
        { error: "Invalid chatId format" },
        { status: 400 }
      );
    }
    const validChatId = validatedChatId.data;

    console.log("Received file for chat:", {
      chatId: validChatId,
      type: file.type,
      size: `${(file.size / 1024).toFixed(2)}KB`,
    });

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      console.error("File validation failed:", errorMessage);
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const originalFile = formData.get("file") as File;
    const filename = originalFile.name;

    // Validate filename
    if (!filename) {
      console.error("Upload failed: Missing filename");
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Generate a safe filename with timestamp and random suffix
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const safeFilename = `${Date.now()}-${randomSuffix}-${filename.replace(
      /[^a-zA-Z0-9.-]/g,
      "_"
    )}`;

    // Construct the directory path for the chat
    const chatUploadDir = join(UPLOADS_DIR, validChatId);
    const filePath = join(chatUploadDir, safeFilename);

    console.log("Processing file:", {
      originalName: filename,
      safeName: safeFilename,
      targetDir: chatUploadDir,
      fullPath: filePath,
    });

    try {
      const fileBuffer = await file.arrayBuffer();
      console.log("Converting file to buffer successful");

      // Ensure the chat-specific directory exists
      await mkdir(chatUploadDir, { recursive: true });
      console.log(`Ensured directory exists: ${chatUploadDir}`);

      // Write file to disk
      await writeFile(filePath, Buffer.from(fileBuffer));

      // Calculate the URL path for the file (relative to the app)
      // The URL now includes the chat ID
      const fileUrl = `/api/uploads/${validChatId}/${safeFilename}`;

      console.log("File upload successful:", {
        url: fileUrl,
        path: filePath,
      });

      // Return the updated URL format
      return NextResponse.json({
        url: fileUrl,
        path: filePath, // Keep the full path if needed internally
        originalName: filename,
        size: file.size,
        type: file.type,
      });
    } catch (error) {
      console.error("File storage error:", error);
      return NextResponse.json(
        {
          error: "Failed to save file to storage",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Request processing error:", error);
    return NextResponse.json(
      {
        error: "Failed to process upload request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
