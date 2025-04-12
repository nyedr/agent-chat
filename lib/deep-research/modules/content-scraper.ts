import { scrapeAndProcessUrls } from "@/app/(chat)/actions"; // Import the server action
import { ScrapeResult } from "@/lib/search/types"; // Import the response type

/**
 * Defines the structure for processed content.
 */
export interface ProcessedContent {
  url: string;
  text: string | null; // Content can be null if scraping fails
  type: "web" | "pdf" | "document" | "error"; // Type of content
  metadata?: Record<string, any>; // Store title, date, etc.
  error?: string; // Error message if processing failed
}

/**
 * Module responsible for scraping content from URLs.
 */
export class ContentScraperModule {
  /**
   * Initializes the ContentScraperModule.
   */
  constructor() {}

  /**
   * Scrapes content from a list of URLs using the Python backend.
   *
   * @param urls - Array of URLs to scrape.
   * @param query - The original search query for context (optional).
   * @param extractTopKChunks - The number of relevant chunks to extract (optional).
   * @returns Promise with array of ScrapeResult objects.
   */
  async processUrls(
    urls: string[],
    query?: string,
    extractTopKChunks?: number
  ): Promise<ScrapeResult[]> {
    // Return the raw ScrapeResult
    if (!urls || urls.length === 0) {
      return [];
    }

    console.log(`[ContentScraper] Requesting scrape for ${urls.length} URLs.`);
    if (query) {
      console.log(
        `[ContentScraper] Query context: ${query.substring(0, 50)}...`
      );
    }
    if (extractTopKChunks) {
      console.log(
        `[ContentScraper] Requesting top ${extractTopKChunks} chunks.`
      );
    }

    try {
      // Call the server action to trigger the Python backend
      const response = await scrapeAndProcessUrls({
        urls,
        query,
        extractTopKChunks,
        crawlingStrategy: "http",
      });

      console.log(
        `[ContentScraper] Received ${response.results.length} results from Python backend.`
      );
      // Return the raw results directly, let the orchestrator handle mapping
      return response.results;
    } catch (error) {
      console.error(
        "[ContentScraper] Error calling scrapeAndProcessUrls action:",
        error
      );
      // Return error entries for all requested URLs if the action itself fails
      return urls.map((url) => ({
        url,
        success: false,
        error: `Scraping action failed: ${(error as Error).message}`,
        title: null,
        publishedDate: null,
        raw_content: null,
        quality_score: 0,
        processed_content: null,
        relevant_chunks: null,
      }));
    }
  }
}
