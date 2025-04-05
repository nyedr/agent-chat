import MetaSearchAgent, { Config } from "./metaSearchAgent";
import prompts from "../prompts";
import { DataStreamWriter } from "ai";

export const searchHandlers: Record<string, Config> = {
  webSearch: {
    activeEngines: [],
    queryGeneratorPrompt: prompts.webSearchRetrieverPrompt,
    responsePrompt: prompts.webSearchResponsePrompt,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
    summarizer: true,
  },
  academicSearch: {
    activeEngines: ["arxiv", "google scholar", "pubmed"],
    queryGeneratorPrompt: prompts.academicSearchRetrieverPrompt,
    responsePrompt: prompts.academicSearchResponsePrompt,
    rerank: true,
    rerankThreshold: 0,
    searchWeb: true,
    summarizer: false,
  },
  writingAssistant: {
    activeEngines: [],
    queryGeneratorPrompt: "",
    responsePrompt: prompts.writingAssistantPrompt,
    rerank: true,
    rerankThreshold: 0,
    searchWeb: false,
    summarizer: false,
  },
  wolframAlphaSearch: {
    activeEngines: ["wolframalpha"],
    queryGeneratorPrompt: prompts.wolframAlphaSearchRetrieverPrompt,
    responsePrompt: prompts.wolframAlphaSearchResponsePrompt,
    rerank: false,
    rerankThreshold: 0,
    searchWeb: true,
    summarizer: false,
  },
  youtubeSearch: {
    activeEngines: ["youtube"],
    queryGeneratorPrompt: prompts.youtubeSearchRetrieverPrompt,
    responsePrompt: prompts.youtubeSearchResponsePrompt,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
    summarizer: false,
  },
  redditSearch: {
    activeEngines: ["reddit"],
    queryGeneratorPrompt: prompts.redditSearchRetrieverPrompt,
    responsePrompt: prompts.redditSearchResponsePrompt,
    rerank: true,
    rerankThreshold: 0.3,
    searchWeb: true,
    summarizer: false,
  },
};

type SearchHandlerKey =
  | "webSearch"
  | "academicSearch"
  | "writingAssistant"
  | "wolframAlphaSearch"
  | "youtubeSearch"
  | "redditSearch";

/**
 * Creates a metaSearch tool that can be used with the AI SDK
 * to perform web searches and document retrieval
 */
export function createMetaSearchTool({
  dataStream,
  handler = "webSearch",
  usePreScrapingRerank = true,
  maxFinalResults = 5,
}: {
  dataStream: DataStreamWriter;
  handler?: SearchHandlerKey;
  usePreScrapingRerank?: boolean;
  maxFinalResults?: number;
}) {
  const selectedConfig: Config = searchHandlers[handler];

  const agent = new MetaSearchAgent(selectedConfig);

  return agent.createMetaSearchTool({
    dataStream,
    usePreScrapingRerank,
    maxFinalResults,
  });
}
