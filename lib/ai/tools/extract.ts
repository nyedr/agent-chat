import FirecrawlApp from "@mendable/firecrawl-js";
import { tool } from "ai";
import { z } from "zod";

interface ExtractToolResult {
  /**
   * The extracted data from the URLs.
   * The structure of this data is dynamic and depends on the extraction prompt provided,
   * hence it is typed as `any`.
   */
  data?: any;
  success: boolean;
  error?: string;
}

export const extractTool = ({ app }: { app: FirecrawlApp }) =>
  tool({
    description:
      "Extract structured data from web pages. Use this to get whatever data you need from a URL. Any time someone needs to gather data from something, use this tool.",
    parameters: z.object({
      urls: z.array(z.string()).describe(
        "Array of URLs to extract data from"
        // , include a /* at the end of each URL if you think you need to search for other pages insides that URL to extract the full data from',
      ),
      prompt: z.string().describe("Description of what data to extract"),
    }),
    execute: async ({ urls, prompt }): Promise<ExtractToolResult> => {
      try {
        const scrapeResult = await app.extract(urls, {
          prompt,
        });

        if (!scrapeResult.success) {
          return {
            error: `Failed to extract data: ${scrapeResult.error}`,
            success: false,
          };
        }

        return {
          data: scrapeResult.data,
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
