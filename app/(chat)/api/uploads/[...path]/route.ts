import { NextRequest, NextResponse } from "next/server";
import * as pathModule from "path";
import { UPLOADS_DIR } from "@/lib/utils";
import { readFile, stat } from "fs/promises";

// Map MIME types for proper content-type headers
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".py": "text/x-python",
  ".csv": "text/csv",
  // Add more types as needed
};

// Helper function to handle path validation and file check
// No longer async itself, just returns parameters or error response
function validateAndGetFilePathParams(
  path: string[] // Changed signature to accept path directly
): { chatId: string; filename: string } | { errorResponse: NextResponse } {
  if (!path || path.length !== 2) {
    // Use path directly
    console.error("Invalid file path format in URL:", path);
    return {
      errorResponse: new NextResponse("Invalid file path", { status: 400 }),
    };
  }

  const [chatId, filename] = path; // Use path directly

  if (!chatId || !filename) {
    console.error("Missing chatId or filename in path:", path);
    return {
      errorResponse: new NextResponse("Invalid file path components", {
        status: 400,
      }),
    };
  }

  // Basic check for obviously malicious patterns before normalization
  if (chatId.includes("..") || filename.includes("..")) {
    console.warn(
      "Potential path traversal pattern detected early:",
      path // Use path directly
    );
    return {
      errorResponse: new NextResponse("Invalid path components", {
        status: 400,
      }),
    };
  }

  // Normalize (still useful for cleaning slashes etc.)
  const safeChatId = pathModule.normalize(chatId);
  const safeFilename = pathModule.normalize(filename);

  // Check if normalization resulted in path traversal attempts
  if (
    safeChatId.includes("..") ||
    safeFilename.includes("..") ||
    safeChatId !== chatId ||
    safeFilename !== filename
  ) {
    console.warn(
      "Potential path traversal after normalization, rejecting:",
      path // Use path directly
    );
    return {
      errorResponse: new NextResponse("Invalid path components", {
        status: 400,
      }),
    };
  }

  // Return validated components
  return { chatId: safeChatId, filename: safeFilename };
}

// --- GET Handler ---
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  // Await params before accessing path
  const { path } = await params;
  // Validate params synchronously using the extracted path
  const validationResult = validateAndGetFilePathParams(path);
  if ("errorResponse" in validationResult) {
    return validationResult.errorResponse;
  }
  const { chatId, filename } = validationResult;

  try {
    const fullPath = pathModule.join(UPLOADS_DIR, chatId, filename);

    // Asynchronous file check using stat
    try {
      await stat(fullPath); // Check existence and permissions
    } catch (statError: any) {
      if (statError.code === "ENOENT") {
        console.error(`File not found: ${fullPath}`);
        return new NextResponse("File not found", { status: 404 });
      } else {
        console.error(`Error accessing file stats for ${fullPath}:`, statError);
        return new NextResponse("Internal server error accessing file", {
          status: 500,
        });
      }
    }

    // Read file content
    const data = await readFile(fullPath);

    const ext = pathModule.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error(`GET Error serving file ${chatId}/${filename}:`, error);
    return new NextResponse("Error serving file", { status: 500 });
  }
}

// --- HEAD Handler ---
export async function HEAD(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  // Await params before accessing path
  const { path } = await params;
  // Validate params synchronously using the extracted path
  const validationResult = validateAndGetFilePathParams(path);
  if ("errorResponse" in validationResult) {
    return validationResult.errorResponse;
  }
  const { chatId, filename } = validationResult;

  try {
    const fullPath = pathModule.join(UPLOADS_DIR, chatId, filename);

    // Asynchronously get file stats
    const fileStats = await stat(fullPath);

    const ext = pathModule.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileStats.size.toString(),
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error: any) {
    console.error(
      `HEAD Error getting file stats for ${chatId}/${filename}:`,
      error
    );
    if (error.code === "ENOENT") {
      return new NextResponse(null, {
        status: 404,
        headers: { "Content-Length": "0" },
      });
    }
    return new NextResponse(null, {
      status: 500,
      headers: { "Content-Length": "0" },
    });
  }
}
