import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { searchSearxng } from "../searxng";

interface VideoSearchResult {
  img_src: string;
  url: string;
  title: string;
  iframe_src: string;
}

const MaxVideoResults = 6;

export function createVideoSearchTool({
  dataStream,
}: {
  dataStream: DataStreamWriter;
}) {
  return tool({
    description: "Search for videos related to a specific query",
    parameters: z.object({
      query: z.string().describe("The search query to find videos for"),
    }),
    execute: async ({ query }) => {
      try {
        // Notify that video search has started
        dataStream.writeData({
          type: "videosearch-start",
          content: { status: "started", query },
        });

        // Perform video search
        const res = await searchSearxng(query, {
          engines: ["youtube"],
        });

        const videos: VideoSearchResult[] = [];

        res.results.slice(0, MaxVideoResults).forEach((result) => {
          if (
            result.thumbnail &&
            result.url &&
            result.title &&
            result.iframe_src
          ) {
            videos.push({
              img_src: result.thumbnail,
              url: result.url,
              title: result.title,
              iframe_src: result.iframe_src,
            });
          }
        });

        dataStream.writeData({
          type: "videosearch-complete",
          content: {
            status: "completed",
            resultCount: videos.length,
          },
        });

        return JSON.stringify({
          query,
          videoCount: videos.length,
          videos: videos.map((vid, i) => ({
            index: i + 1,
            title: vid.title,
            url: vid.url,
            source: vid.iframe_src,
            thumbnailUrl: vid.img_src,
          })),
        });
      } catch (error) {
        console.error("Error in videoSearch tool:", error);
        dataStream.writeData({
          type: "videosearch-error",
          content: { error: (error as Error).message },
        });
        return `Error performing video search: ${(error as Error).message}`;
      }
    },
  });
}
