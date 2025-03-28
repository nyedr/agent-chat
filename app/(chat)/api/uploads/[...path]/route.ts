import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { UPLOADS_DIR } from "@/lib/utils";

// Map MIME types for proper content-type headers
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
};

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    // Ensure the path is properly sanitized
    const filePath = params.path.join("/");

    // Prevent path traversal attacks
    const normalizedPath = path
      .normalize(filePath)
      .replace(/^(\.\.(\/|\\|$))+/, "");

    // Construct the full path to the file
    const fullPath = path.join(UPLOADS_DIR, normalizedPath);

    // Dynamically import fs modules
    const { existsSync } = await import("fs");
    const { readFile } = await import("fs/promises");

    // Check if file exists
    if (!existsSync(fullPath)) {
      console.error(`File not found: ${fullPath}`);
      return new NextResponse("File not found", { status: 404 });
    }

    // Read file
    const data = await readFile(fullPath);

    // Determine content type based on file extension
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    // Return file with proper content type
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000", // Cache for 1 year
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return new NextResponse("Error serving file", { status: 500 });
  }
}
