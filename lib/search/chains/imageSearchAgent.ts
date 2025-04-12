import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { searchSearxng } from "../searxng";

export interface ImageSearchResult {
  img_src: string;
  url: string;
  title: string;
}

const maxImages = 5;

export function createImageSearchTool({
  dataStream,
}: {
  dataStream: DataStreamWriter;
}) {
  return tool({
    description: "Search for images related to a specific query",
    parameters: z.object({
      query: z.string().describe("The search query to find images for"),
    }),
    execute: async ({ query }) => {
      try {
        dataStream.writeData({
          type: "imagesearch-start",
          content: { status: "started", query },
        });

        const res = await searchSearxng(query, {
          engines: ["bing images", "google images"],
        });

        const images: ImageSearchResult[] = [];

        res.results.slice(0, maxImages).forEach((result) => {
          if (result.img_src && result.url && result.title) {
            images.push({
              img_src: result.img_src,
              url: result.url,
              title: result.title,
            });
          }
        });

        dataStream.writeData({
          type: "imagesearch-complete",
          content: {
            status: "completed",
            resultCount: images.length,
          },
        });

        // Return data in JSON format for the LLM to process
        return JSON.stringify({
          query,
          imageCount: images.length,
          images: images.map((img, i) => ({
            index: i + 1,
            title: img.title,
            url: img.url,
            source: img.img_src,
            thumbnailUrl: img.img_src,
          })),
        });
      } catch (error) {
        console.error("Error in imageSearch tool:", error);
        dataStream.writeData({
          type: "imagesearch-error",
          content: { error: (error as Error).message },
        });
        return `Error performing image search: ${(error as Error).message}`;
      }
    },
  });
}
