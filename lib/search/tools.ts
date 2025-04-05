import { DataStreamWriter, Tool } from "ai";
import { createMetaSearchTool } from "./agent/index";
import { createImageSearchTool } from "./chains/imageSearchAgent";
import { createVideoSearchTool } from "./chains/videoSearchAgent";

interface SearchTools {
  searchTool: Tool;
  imageSearchTool: Tool;
  videoSearchTool: Tool;
}

interface SearchToolsParams {
  dataStream: DataStreamWriter;
  searchHandler?:
    | "webSearch"
    | "academicSearch"
    | "writingAssistant"
    | "wolframAlphaSearch"
    | "youtubeSearch"
    | "redditSearch";
  maxFinalResults?: number;
  usePreScrapingRerank?: boolean;
}

/**
 * Creates all search-related tools that can be used with the AI SDK
 */
export function createSearchTools({
  dataStream,
  maxFinalResults = 3,
  usePreScrapingRerank = false,
}: SearchToolsParams): SearchTools {
  return {
    searchTool: createMetaSearchTool({
      dataStream,
      maxFinalResults,
      usePreScrapingRerank,
    }),

    imageSearchTool: createImageSearchTool({
      dataStream,
    }),

    videoSearchTool: createVideoSearchTool({
      dataStream,
    }),
  };
}

export default createSearchTools;
