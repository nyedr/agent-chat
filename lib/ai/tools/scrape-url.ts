import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { scrapeAndProcessUrls } from "@/app/(chat)/actions";
import { SearchResultItem, SearchToolResponse } from "@/lib/search/types";
import { getFaviconUrl } from "@/lib/utils";

export const scrapeUrl = ({ dataStream }: { dataStream: DataStreamWriter }) =>
  tool({
    description: "Scrape a URL for information",
    parameters: z.object({
      url: z.string().describe("The URL to scrape content from"),
    }),
    execute: async ({ url }): Promise<SearchToolResponse> => {
      dataStream.writeData({
        type: "scrape-url-start",
        content: { status: "started", url },
      });

      try {
        const { results } = await scrapeAndProcessUrls({
          urls: [url],
          crawlingStrategy: "http",
        });
        const scrapedUrlResult = results[0];

        if (
          !scrapedUrlResult ||
          !scrapedUrlResult.success ||
          scrapedUrlResult.error
        ) {
          const errorMessage =
            scrapedUrlResult?.error || "Unknown error during scraping";
          console.error(
            `[scrapeUrl tool] Failed to scrape URL ${url}: ${errorMessage}`
          );
          dataStream.writeData({
            type: "scrape-url-error",
            content: { url, error: errorMessage },
          });
          // Return error within SearchToolResponse structure
          const errorItem: SearchResultItem = {
            title: `Error scraping: ${url}`,
            url,
            description: errorMessage,
          };
          return {
            text: `Failed to scrape the URL: ${url}. Error: ${errorMessage}`,
            data: [errorItem],
            query: url,
            suggestions: [],
          };
        }

        // Send completion event
        dataStream.writeData({
          type: "scrape-url-complete",
          content: {
            status: "completed",
            url,
            title: scrapedUrlResult.title ?? null,
          },
        });

        // Construct the single result item
        const resultItem: SearchResultItem = {
          title: scrapedUrlResult.title ?? "Untitled",
          url,
          description:
            scrapedUrlResult.processed_content?.substring(0, 200) +
            (scrapedUrlResult.processed_content &&
            scrapedUrlResult.processed_content.length > 200
              ? "..."
              : ""),
          relevantContent: scrapedUrlResult.processed_content ?? null,
          favicon: getFaviconUrl(url),
          publishedDate: scrapedUrlResult.publishedDate ?? null,
          source: url,
        };

        // Return success within SearchToolResponse structure
        return {
          text:
            scrapedUrlResult.processed_content ||
            `Content successfully scraped from ${url}, but no text content was extracted.`,
          data: [resultItem],
          query: url,
          suggestions: [],
        };
      } catch (error) {
        // Catch unexpected errors during the process
        const errorMessage =
          error instanceof Error ? error.message : "Unexpected error occurred";
        console.error(
          `[scrapeUrl tool] Unexpected error scraping URL ${url}:`,
          error
        );
        dataStream.writeData({
          type: "scrape-url-error",
          content: { url, error: errorMessage },
        });
        // Return unexpected error within SearchToolResponse structure
        const errorItem: SearchResultItem = {
          title: `Unexpected error scraping: ${url}`,
          url,
          description: errorMessage,
        };
        return {
          text: `An unexpected error occurred while scraping the URL: ${url}. Error: ${errorMessage}`,
          data: [errorItem],
          query: url,
          suggestions: [],
        };
      }
    },
  });
