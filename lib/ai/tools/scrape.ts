import { tool } from "ai";
import { z } from "zod";
import FirecrawlApp from "@mendable/firecrawl-js";

interface ScrapeToolResult {
  /**
   * The markdown content of the scraped page.
   */
  data?: string;
  success: boolean;
  error?: string;
}

export const scrapeTool = ({ app }: { app: FirecrawlApp }) =>
  tool({
    description:
      "Scrape web pages. Use this to get from a page when you have the url.",
    parameters: z.object({
      url: z.string().describe("URL to scrape"),
    }),
    execute: async ({ url }: { url: string }): Promise<ScrapeToolResult> => {
      try {
        const scrapeResult = await app.scrapeUrl(url);

        if (!scrapeResult.success) {
          return {
            error: `Failed to extract data: ${scrapeResult.error}`,
            success: false,
          };
        }

        return {
          data:
            scrapeResult.markdown ??
            "Could get the page content, try using search or extract",
          success: true,
        };
      } catch (error: any) {
        console.error("Extraction error:", error);
        console.error(error.message);
        console.error(error.error);
        return {
          error: `Extraction failed: ${error.message}`,
          success: false,
        };
      }
    },
  });
