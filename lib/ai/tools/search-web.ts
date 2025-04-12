import { DataStreamWriter, tool } from "ai";
import { z } from "zod";
import { searchSearxng } from "@/lib/search/searxng";
import { SearchResultItem } from "@/lib/search/types";

export interface SearchWebResult {
  answers: string[];
  results: SearchResultItem[];
  suggestions: string[];
}

export const searchWeb = ({ dataStream }: { dataStream: DataStreamWriter }) =>
  tool({
    description: "Search the web for links to relevant information",
    parameters: z.object({
      query: z
        .string()
        .describe("Search query in Google search style, using 3-5 keywords."),
      limit: z.number().describe("The number of results to return").default(5),
      time_range: z
        .enum(["day", "week", "month", "year"])
        .describe(
          "The time range to search for (e.g., past day, week, month, or year)"
        )
        .optional(),
    }),
    execute: async ({
      query,
      limit = 5,
      time_range,
    }): Promise<SearchWebResult> => {
      dataStream.writeData({
        type: "search-web-start",
        content: { status: "started", query },
      });

      const { answers, results, suggestions } = await searchSearxng(query, {
        time_range,
      });

      dataStream.writeData({
        type: "search-web-results",
        content: "Search completed",
      });

      const formattedResults = results.slice(0, limit).map(
        (result) =>
          ({
            title: result.title,
            url: result.url,
            content: result.content,
            publishedDate: result.publishedDate,
            score: result.score,
            author: result.author,
          } as SearchResultItem)
      );

      return {
        answers: answers.map((answer) => answer.answer),
        results: formattedResults,
        suggestions,
      };
    },
  });
