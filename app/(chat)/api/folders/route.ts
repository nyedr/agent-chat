import { z } from "zod";
import {
  createFolder,
  getAllFolders,
  updateFolder,
  deleteFolder,
} from "@/app/(chat)/actions";

// Validation schemas
const folderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
});

const updateFolderSchema = z.object({
  name: z.string().min(1, "Folder name is required"),
});

// GET /api/folders - Get all folders
export async function GET() {
  try {
    const folders = await getAllFolders();
    return Response.json({
      data: folders,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error getting folders:", error);
    return Response.json({
      data: null,
      error: "Failed to get folders",
      status: 500,
    });
  }
}

// POST /api/folders - Create a new folder
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = folderSchema.safeParse(body);

    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    const { id } = await createFolder(result.data.name);
    const folders = await getAllFolders();

    return Response.json({
      data: folders,
      error: null,
      status: 201,
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    return Response.json({
      data: null,
      error: "Failed to create folder",
      status: 500,
    });
  }
}

// PUT /api/folders - Update a folder
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({
        data: null,
        error: "Folder ID is required",
        status: 400,
      });
    }

    const body = await request.json();
    const result = updateFolderSchema.safeParse(body);

    if (!result.success) {
      return Response.json({
        data: null,
        error: result.error.errors[0].message,
        status: 400,
      });
    }

    await updateFolder({ id, name: result.data.name });
    const folders = await getAllFolders();

    return Response.json({
      data: folders,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error updating folder:", error);
    return Response.json({
      data: null,
      error: "Failed to update folder",
      status: 500,
    });
  }
}

// DELETE /api/folders - Delete a folder
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({
        data: null,
        error: "Folder ID is required",
        status: 400,
      });
    }

    await deleteFolder(id);
    const folders = await getAllFolders();

    return Response.json({
      data: folders,
      error: null,
      status: 200,
    });
  } catch (error) {
    console.error("Error deleting folder:", error);
    return Response.json({
      data: null,
      error: "Failed to delete folder",
      status: 500,
    });
  }
}
