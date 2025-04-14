import {
  DeepResearchToolResult,
  deepResearch,
} from "@/lib/deep-research/adapter";
import { CreateDocumentToolResult, createDocument } from "./create-document";
import { FileReadResult, fileRead } from "./file-read";
import {
  PythonInterpreterResult,
  pythonInterpreter,
} from "./python-interpreter";
import { SearchWebResult, searchWeb } from "./search-web";
import { SearchToolResponse } from "@/lib/search/types";
import { VideoSearchResult } from "@/lib/search/chains/videoSearchAgent";
import { ImageSearchResult } from "@/lib/search/chains/imageSearchAgent";
import { ListDirectoryToolResult, listDirectory } from "./list-directory";
import { DeleteDocumentToolResult, deleteDocument } from "./delete-document";
import {
  ExtractStructuredDataToolResult,
  extractStructuredData,
} from "./extract-structured-data";
import { DataStreamWriter } from "ai";
import { ModelsByCapability } from "@/lib/ai/models";
import { createSearchTools } from "@/lib/search/tools";
import { scrapeUrl } from "./scrape-url";
import { editDocument, type EditDocumentResult } from "./edit-document";
import { getFileInfo, type GetFileInfoResult } from "./get-file-info";
import { readDocument, type ReadDocumentResult } from "./read-document";

interface ToolReturnTypes {
  createDocument: CreateDocumentToolResult;
  deepResearch: DeepResearchToolResult;
  searchWeb: SearchWebResult;
  pythonInterpreter: PythonInterpreterResult;
  fileRead: FileReadResult;
  scrapeUrl: SearchToolResponse;
  imageSearch: ImageSearchResult[];
  videoSearch: VideoSearchResult[];
  listDirectory: ListDirectoryToolResult;
  deleteDocument: DeleteDocumentToolResult;
  extractStructuredData: ExtractStructuredDataToolResult;
  editDocument: EditDocumentResult;
  getFileInfo: GetFileInfoResult;
  readDocument: ReadDocumentResult;
}

type ToolName = keyof ToolReturnTypes;

export type { ToolReturnTypes, ToolName };

/**
 * Interface for createModelTools parameters
 */
export interface CreateModelToolsParams {
  dataStream: DataStreamWriter;
  chatId?: string;
  models: {
    deepResearch: ModelsByCapability;
    search?: ModelsByCapability;
  };
  usePreScrapingRerank?: boolean;
  maxFinalResults?: number;
}

/**
 * Creates and initializes all available tools with the necessary parameters
 * @param params Parameters needed for tool initialization
 * @returns An object containing all initialized tools
 */
export function createModelTools(params: CreateModelToolsParams) {
  const {
    dataStream,
    chatId,
    models,
    usePreScrapingRerank = false,
    maxFinalResults,
  } = params;

  const searchTools = createSearchTools({
    dataStream,
    usePreScrapingRerank,
    maxFinalResults,
  });

  // Ensure chatId is defined for functions that require it
  if (!chatId) {
    throw new Error("chatId is required for file and document operations");
  }

  // Create and return all tools
  return {
    // File operations
    fileRead: fileRead({
      dataStream,
      chatId,
    }),
    listDirectory: listDirectory({
      dataStream,
      chatId,
    }),
    deleteDocument: deleteDocument({
      dataStream,
      chatId,
    }),

    // Document operations
    createDocument: createDocument({
      dataStream,
      chatId,
    }),

    // Web/Search operations
    searchWeb: searchWeb({
      dataStream,
    }),
    scrapeUrl: scrapeUrl({
      dataStream,
    }),
    imageSearch: searchTools.imageSearchTool,
    videoSearch: searchTools.videoSearchTool,

    // Analysis operations
    deepResearch: deepResearch({
      dataStream,
      models: models.deepResearch,
    }),
    pythonInterpreter: pythonInterpreter({
      dataStream,
      chatId,
    }),
    extractStructuredData: extractStructuredData({
      dataStream,
      chatId,
    }),
    editDocument: editDocument({
      dataStream,
    }),
    getFileInfo: getFileInfo({
      dataStream,
      chatId,
    }),
    readDocument: readDocument({
      dataStream,
    }),
  };
}
