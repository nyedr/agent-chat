import FirecrawlApp, {
  FirecrawlDocument,
  SearchResponse,
} from "@mendable/firecrawl-js";
import { tool } from "ai";
import { z } from "zod";

interface SearchToolResult {
  data?: FirecrawlDocument<undefined, never>[];
  success: boolean;
  error?: string;
}

export const searchTool = ({ app }: { app: FirecrawlApp }) =>
  tool({
    description:
      "Search for web pages. Normally you should call the extract tool after this one to get a spceific data point if search doesn't the exact data you need.",
    parameters: z.object({
      query: z.string().describe("Search query to find relevant web pages"),
      maxResults: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default 10)"),
    }),
    execute: async ({ query }): Promise<SearchToolResult> => {
      try {
        const searchResult: SearchResponse = await app.search(query);

        if (!searchResult.success) {
          return {
            error: `Search failed: ${searchResult.error}`,
            success: false,
          };
        }

        // Add favicon URLs to search results
        const resultsWithFavicons = searchResult.data.map((result: any) => {
          const url = new URL(result.url);
          const favicon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
          return {
            ...result,
            favicon,
          };
        });

        searchResult.data = resultsWithFavicons;

        return {
          data: searchResult.data,
          success: true,
        };
      } catch (error: any) {
        return {
          error: `Search failed: ${error.message}`,
          success: false,
        };
      }
    },
  });
