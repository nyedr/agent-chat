import { searchSearxng } from "@/lib/search/searxng";

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
    year?: string,
    limit: number = 20
  ): Promise<ResearchSearchResult[]> {
    try {
      const { results } = await searchSearxng(query, {
        language: "en",
      });

      const mappedResults: ResearchSearchResult[] = results.map((result) => ({
        url: result.url,
        title: result.title,
        snippet: result.content,
      }));

      return mappedResults.slice(0, limit);
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
    year?: string,
    limitPerQuery: number = 5,
    removeDuplicates: boolean = true
  ): Promise<ResearchSearchResult[]> {
    try {
      const allResultsPromises = queries.map((query) =>
        this.searchWeb(query, year, limitPerQuery)
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

      // Apply an overall limit if desired, although limitPerQuery might be sufficient
      // return combinedResults.slice(0, overallLimit);
      return combinedResults;
    } catch (error) {
      console.error(`Error performing multiple web searches:`, error);
      return []; // Return empty array on error
    }
  }
}
