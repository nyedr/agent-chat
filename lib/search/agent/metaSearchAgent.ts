import { Document } from "@langchain/core/documents";
import { DataStreamWriter, tool, type Tool } from "ai";
import { z } from "zod";
import { searchSearxng, SearxngSearchResult } from "../searxng";
import { getDocumentsFromLinks } from "../documents";
import { SearchResultItem, SearchToolResponse, ScrapeResult } from "../types";
import { scrapeAndProcessUrls, rerankDocuments } from "@/app/(chat)/actions";
import { extractLinks, getFaviconUrl } from "@/lib/utils";
import { formatSearchResults } from "../utils";

export interface MetaSearchAgentType {
  /**
   * Creates a tool function that can be used with the AI SDK
   */
  createMetaSearchTool: (args: {
    dataStream: DataStreamWriter;
    usePreScrapingRerank: boolean;
    maxFinalResults: number;
  }) => Tool;
}

export interface Config {
  searchWeb: boolean;
  rerank: boolean;
  summarizer: boolean;
  rerankThreshold: number;
  queryGeneratorPrompt: string;
  responsePrompt: string;
  activeEngines: string[];
}

class MetaSearchAgent implements MetaSearchAgentType {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private async performSearch(query: string): Promise<{
    query: string;
    docs: Document[];
    source: string;
    answers: any[];
    suggestions: string[];
    rawResults: SearxngSearchResult[];
  }> {
    // Check if there are any links in the query
    const links = extractLinks(query);

    if (links.length > 0) {
      const docs = await getDocumentsFromLinks({ links });

      return {
        query,
        docs,
        source: "user-provided-links",
        answers: [],
        suggestions: [],
        rawResults: [],
      };
    } else {
      const { results, answers, suggestions } = await searchSearxng(query, {
        language: "en",
        engines: this.config.activeEngines,
      });

      const documents = results.map((result) => {
        const metadata: Record<string, any> = {
          title: result.title,
          url: result.url,
        };

        if (result.img_src) metadata.img_src = result.img_src;
        if (result.publishedDate) metadata.publishedDate = result.publishedDate;

        return new Document({
          pageContent:
            result.content ||
            (this.config.activeEngines.includes("youtube") ? result.title : ""),
          metadata,
        });
      });

      return {
        query,
        docs: documents,
        source: "web-search",
        answers,
        suggestions,
        rawResults: results,
      };
    }
  }

  /**
   * Creates a tool function that can be used with the AI SDK
   */
  createMetaSearchTool({
    dataStream,
    usePreScrapingRerank,
    maxFinalResults,
  }: {
    dataStream: DataStreamWriter;
    usePreScrapingRerank: boolean;
    maxFinalResults: number;
  }) {
    return tool({
      description: "Search the web for information on a specific query",
      parameters: z.object({
        query: z
          .string()
          .describe("The search query to look up information for"),
        fileIds: z
          .array(z.string())
          .optional()
          .describe("Optional file IDs (Note: Currently not processed)"),
      }),
      execute: async ({ query, fileIds = [] }) => {
        let finalResults: SearchResultItem[] = [];
        let answers: any[] = [];
        let suggestions: string[] = [];
        let source = "unknown";
        let initialRawResults: SearxngSearchResult[] = [];
        const maxUrlsToScrape = 5;

        try {
          dataStream.writeData({
            type: "metasearch-start",
            content: { status: "started", query },
          });

          const searchResult = await this.performSearch(query);
          source = searchResult.source;
          answers = searchResult.answers;
          suggestions = searchResult.suggestions;
          initialRawResults = searchResult.rawResults;

          let rankedUrls: string[] = [];
          if (
            usePreScrapingRerank &&
            source === "web-search" &&
            initialRawResults.length > 0
          ) {
            dataStream.writeData({
              type: "metasearch-update",
              content: {
                status: "reranking",
                message: "Reranking initial results...",
              },
            });
            try {
              const initialDocsToRerank = initialRawResults.map((r, i) => ({
                id: r.url || `initial-${i}`,
                text: `${r.title || ""} ${r.content || ""}`,
              }));
              const rerankResponse = await rerankDocuments(
                query,
                initialDocsToRerank,
                initialRawResults.length
              );
              rankedUrls = rerankResponse.reranked_documents.map((d) => d.id);
              console.log(`[MetaSearch] Reranked ${rankedUrls.length} URLs.`);
            } catch (rerankError) {
              console.error(
                "Pre-scraping rerank failed, falling back to original order:",
                rerankError
              );
              rankedUrls = initialRawResults.map((r) => r.url);
            }
          } else if (source === "web-search") {
            rankedUrls = initialRawResults.map((r) => r.url);
          }

          const finalOutputUrls = rankedUrls.slice(0, maxFinalResults);
          const urlsToScrape = finalOutputUrls.slice(0, maxUrlsToScrape);

          let processedDataMap = new Map<string, ScrapeResult>();
          if (urlsToScrape.length > 0) {
            dataStream.writeData({
              type: "metasearch-update",
              content: {
                status: "scraping",
                message: `Fetching content for ${urlsToScrape.length} URLs...`,
              },
            });
            try {
              const scrapeResponse = await scrapeAndProcessUrls({
                urls: urlsToScrape,
                query,
                extractTopKChunks: 3,
                crawlingStrategy: "http",
              });
              processedDataMap = new Map(
                scrapeResponse.results.map((r) => [r.url, r])
              );
            } catch (scrapeError) {
              console.error("Scraping/processing failed:", scrapeError);
              urlsToScrape.forEach((url) => {
                if (!processedDataMap.has(url)) {
                  processedDataMap.set(url, {
                    url,
                    success: false,
                    error: (scrapeError as Error).message || "Scraping failed",
                  });
                }
              });
            }
          }

          if (source === "web-search") {
            const initialResultsMap = new Map(
              initialRawResults.map((r) => [r.url, r])
            );

            const mappedResults: (SearchResultItem | null)[] =
              finalOutputUrls.map((url) => {
                const rawResult = initialResultsMap.get(url);
                if (!rawResult) return null;

                const processed = processedDataMap.get(url);
                const hostname = new URL(rawResult.url).hostname;

                let relevantContent: string | null = null;
                if (processed?.success) {
                  relevantContent =
                    processed.relevant_chunks?.join("\n\n") ||
                    processed.processed_content ||
                    null;
                } else if (processed) {
                  relevantContent = `Error processing: ${
                    processed.error || "Unknown"
                  }`;
                }

                const resultItem: SearchResultItem = {
                  title: processed?.title || rawResult.title || "Untitled",
                  url: rawResult.url,
                  description: rawResult.content || "",
                  source: rawResult.url,
                  favicon: getFaviconUrl(rawResult.url),
                  publishedDate:
                    processed?.publishedDate || rawResult.publishedDate || null,
                  relevantContent: relevantContent,
                };
                return resultItem;
              });

            finalResults = mappedResults.filter(
              (r): r is SearchResultItem => r !== null
            );
          } else if (source === "user-provided-links") {
            finalResults = searchResult.docs
              .slice(0, maxFinalResults)
              .map((doc, i) => {
                const hostname = new URL(doc.metadata.url).hostname;
                const description =
                  (doc.pageContent || "").substring(0, 200) +
                  ((doc.pageContent?.length || 0) > 200 ? "..." : "");
                return {
                  title: doc.metadata.title || `Link ${i + 1}`,
                  url: doc.metadata.url,
                  description: description,
                  source: doc.metadata.url,
                  favicon: getFaviconUrl(doc.metadata.url),
                  publishedDate: doc.metadata.publishedDate || null,
                  relevantContent: doc.pageContent,
                };
              });
          } else {
            finalResults = [];
          }

          if (fileIds.length > 0) {
            console.warn(
              "File processing (fileIds) is not fully integrated yet."
            );
          }

          const finalResultsJSON = finalResults.map((r) => ({ ...r }));
          dataStream.writeData({
            type: "search-results",
            content: { data: finalResultsJSON, query },
          });
          dataStream.writeData({
            type: "metasearch-complete",
            content: {
              status: "completed",
              resultCount: finalResults.length,
              data: finalResultsJSON,
            },
          });

          let formattedText = "";
          if (answers && answers.length > 0) {
            formattedText +=
              "Direct Answers Found:\n" +
              answers.map((ans, i) => `[A${i + 1}] ${ans.answer}`).join("\n") +
              "\n\nSearch Results:\n";
          } else {
            formattedText += "Search Results:\n";
          }

          formattedText +=
            finalResults.length > 0
              ? formatSearchResults(finalResults)
              : "No relevant results found.";

          const response: SearchToolResponse = {
            text: formattedText,
            data: finalResultsJSON,
            query,
            suggestions,
          };
          return response;
        } catch (error) {
          console.error("Error in metaSearch tool execute block:", error);
          dataStream.writeData({
            type: "metasearch-error",
            content: { error: (error as Error).message },
          });
          return `Error performing search: ${(error as Error).message}`;
        }
      },
    });
  }
}

export default MetaSearchAgent;
