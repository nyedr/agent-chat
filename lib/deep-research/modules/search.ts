import { searchSearxng, SearxngSearchResult } from "@/lib/search/searxng";

/**
 * Module responsible for performing web searches.
 */
export class SearchModule {
  /**
   * Initializes the SearchModule.
   */
  constructor() {}

  /**
   * Performs a web search for the given query, potentially prioritizing specific domains.
   *
   * @param query - The search query.
   * @param limit - Maximum number of results to return.
   * @param forceDomains - Optional array of domains to prioritize with "site:" filters.
   * @returns Promise with an array of search results.
   */
  async searchWeb(
    query: string,
    limit: number = 15,
    forceDomains: string[] = []
  ): Promise<SearxngSearchResult[]> {
    try {
      let domainResults: SearxngSearchResult[] = [];
      let generalResults: SearxngSearchResult[] = [];
      const searchPromises: Promise<SearxngSearchResult[]>[] = [];

      // Prepare domain search promise if needed
      if (forceDomains.length > 0) {
        const domainQuery = `${forceDomains
          .map((d) => `site:${d}`)
          .join(" OR ")} ${query}`;
        searchPromises.push(
          searchSearxng(domainQuery, { language: "en" })
            .then(({ results }) => {
              console.log(
                `[SearchModule] Domain search for "${domainQuery.substring(
                  0,
                  50
                )}..." returned ${results.length} results.`
              );
              domainResults = results; // Assign inside promise
              return results;
            })
            .catch((domainError) => {
              console.warn(
                `[SearchModule] Domain-specific search failed for query "${domainQuery}":`,
                domainError
              );
              return []; // Return empty array on error
            })
        );
      } else {
        // Add a resolved empty promise to keep Promise.all structure
        searchPromises.push(Promise.resolve([]));
      }

      // Prepare general search promise - potentially conditional
      const generalSearchPromise = searchSearxng(query, { language: "en" })
        .then(({ results }) => {
          console.log(
            `[SearchModule] General search for "${query.substring(
              0,
              50
            )}..." returned ${results.length} results.`
          );
          generalResults = results; // Assign inside promise
          return results;
        })
        .catch((generalError) => {
          console.error(
            `[SearchModule] General search failed for query "${query}":`,
            generalError
          );
          return []; // Return empty array on error
        });

      // Execute searches
      const [domainSearchOutput] = await Promise.all(searchPromises);
      domainResults = domainSearchOutput; // Assign results from promise output

      // Decide whether to run general search based on domain results
      if (domainResults.length < 3) {
        // If domain search yielded few/no results or failed, run general search
        console.log(
          "[SearchModule] Domain results < 3, running general search."
        );
        generalResults = await generalSearchPromise;
      } else {
        // If domain search was sufficient, skip general search for latency
        console.log(
          "[SearchModule] Domain results >= 3, skipping immediate general search (will use empty array)."
        );
        // Keep generalResults as [] to avoid unnecessary fetch
      }

      // Combine results, prioritizing domain results
      const combinedResults = [...domainResults, ...generalResults];

      // Deduplicate
      const seenUrls = new Set<string>();
      const uniqueResults = combinedResults.filter((result) => {
        if (seenUrls.has(result.url)) {
          return false;
        }
        seenUrls.add(result.url);
        return true;
      });

      console.log(
        `[SearchModule] Combined and deduplicated ${domainResults.length} domain + ${generalResults.length} general results into ${uniqueResults.length} unique results.`
      );

      // Limit results
      return uniqueResults.slice(0, limit);
    } catch (error) {
      console.error(`Error performing web search for "${query}":`, error);
      return []; // Return empty on unexpected errors
    }
  }

  /**
   * Performs multiple web searches concurrently for variations of a query.
   *
   * @param queries - Array of search queries.
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
      // Note: searchMultiple doesn't currently support forceDomains per query
      // It could be added if needed, but complicates the logic significantly
      const allResultsPromises = queries.map(
        (query) => this.searchWeb(query, limitPerQuery) // Calls the updated searchWeb
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
