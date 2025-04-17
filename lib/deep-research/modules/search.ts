import { searchSearxng, SearxngSearchResult } from "@/lib/search/searxng";

/**
 * Represents a search result relevant to the research process.
 */
export interface ResearchSearchResult {
  url: string;
  title?: string;
  snippet?: string;
}

/**
 * Module responsible for performing web searches.
 */
export class SearchModule {
  /**
   * Initializes the SearchModule.
   */
  constructor() {}

  /**
   * Performs a web search for the given query.
   *
   * @param query - The search query.
   * @param year - Optional year filter (currently unused with SearxNG).
   * @param limit - Maximum number of results (handled by SearxNG options).
   * @returns Promise with an array of search results.
   */
  async searchWeb(
    query: string,
    limit: number = 15
  ): Promise<SearxngSearchResult[]> {
    try {
      const { results } = await searchSearxng(query, {
        language: "en",
      });

      return results.slice(0, limit);
    } catch (error) {
      console.error(`Error performing web search for "${query}":`, error);
      return [];
    }
  }

  /**
   * Performs multiple web searches concurrently for variations of a query.
   *
   * @param queries - Array of search queries.
   * @param year - Optional year filter.
   * @param limitPerQuery - Maximum results per query.
   * @param removeDuplicates - Whether to remove duplicate URLs.
   * @returns Promise with a consolidated array of search results.
   */
  async searchMultiple(
    queries: string[],
    limitPerQuery: number = 5,
    removeDuplicates: boolean = true
  ): Promise<SearxngSearchResult[]> {
    try {
      const allResultsPromises = queries.map((query) =>
        this.searchWeb(query, limitPerQuery)
      );

      const resultsArrays = await Promise.all(allResultsPromises);
      let combinedResults = resultsArrays.flat();

      if (removeDuplicates) {
        const seenUrls = new Set<string>();
        combinedResults = combinedResults.filter((result) => {
          if (seenUrls.has(result.url)) {
            return false;
          }
          seenUrls.add(result.url);
          return true;
        });
      }

      return combinedResults;
    } catch (error) {
      console.error(`Error performing multiple web searches:`, error);
      return [];
    }
  }
}
