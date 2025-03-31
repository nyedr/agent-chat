import type FirecrawlApp from "@mendable/firecrawl-js";
import { normalizeUrl } from "../../utils";

/**
 * Interface for search result data structure
 */
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  date?: string;
  source?: string;
  relevance?: number;
}

/**
 * Search module for retrieving information from the web.
 */
export class SearchModule {
  private firecrawl: FirecrawlApp;

  constructor(firecrawlApp: FirecrawlApp) {
    this.firecrawl = firecrawlApp;
  }

  /**
   * Searches the web for a given query and returns structured results.
   * @param query - The research query string
   * @param filterYear - Optional year to filter results
   * @param maxResults - Optional maximum number of results to return
   * @returns Promise with array of SearchResult objects
   */
  async searchWeb(
    query: string,
    filterYear?: number,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    try {
      // Add year filter to query if provided
      const searchQuery = filterYear ? `${query} year:${filterYear}` : query;

      // Search using Firecrawl
      const searchResponse = await this.firecrawl.search(searchQuery);

      if (!searchResponse.success) {
        console.error(`Search failed: ${searchResponse.error}`);
        return [];
      }

      // Transform results to SearchResult format
      const results = searchResponse.data.map((result: any, index: number) => ({
        url: result.url,
        title: result.title,
        snippet: result.description || "",
        date: this.extractDateFromResult(result),
        source: new URL(result.url).hostname,
        relevance: result.score || 10 - index, // Use provided score or calculate based on position
      }));

      // Return results, limited to maxResults if specified
      return results.slice(0, maxResults);
    } catch (error) {
      console.error("Search error:", error);
      return [];
    }
  }

  /**
   * Performs multiple searches with different queries and aggregates the results.
   *
   * @param queries - Array of query strings to search for
   * @param filterYear - Optional year to filter results
   * @param maxResultsPerQuery - Maximum results to return per query
   * @param removeDuplicates - Whether to remove duplicate URLs from results
   * @returns Promise with array of SearchResult objects
   */
  async searchMultiple(
    queries: string[],
    filterYear?: number,
    maxResultsPerQuery: number = 5,
    removeDuplicates: boolean = true
  ): Promise<SearchResult[]> {
    // Handle empty queries
    if (!queries.length) {
      return [];
    }

    // Search for each query in parallel
    const searchPromises = queries.map((query) =>
      this.searchWeb(query, filterYear, maxResultsPerQuery)
    );

    // Wait for all searches to complete
    const searchResults = await Promise.all(searchPromises);

    // Flatten the results
    let allResults = searchResults.flat();

    // Remove duplicates if requested
    if (removeDuplicates) {
      const seen = new Set<string>();
      allResults = allResults.filter((result) => {
        const normalizedUrl = normalizeUrl(result.url);
        if (seen.has(normalizedUrl)) {
          return false;
        }
        seen.add(normalizedUrl);
        return true;
      });
    }

    return allResults;
  }

  /**
   * Extracts a date from a search result if available
   *
   * @param result - Search result object
   * @returns Date string or undefined
   */
  private extractDateFromResult(result: any): string | undefined {
    // Check for explicit date field
    if (result.date) {
      return result.date;
    }

    // Try to extract date from metadata
    if (result.metadata && result.metadata.date) {
      return result.metadata.date;
    }

    // Try to extract date from description
    if (result.description) {
      // Look for date patterns: YYYY-MM-DD, MM/DD/YYYY, etc.
      const dateMatch =
        result.description.match(
          /\b(19|20)\d\d[-/](0[1-9]|1[012])[-/](0[1-9]|[12][0-9]|3[01])\b/
        ) ||
        result.description.match(
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+(19|20)\d\d\b/i
        );

      if (dateMatch) {
        return dateMatch[0];
      }

      // Look for year mentions
      const yearMatch = result.description.match(
        /\b(in|from|since|during|copyright|©)\s+(19|20)\d\d\b/i
      );
      if (yearMatch) {
        return yearMatch[2]; // Just return the year
      }
    }

    return undefined;
  }
}
