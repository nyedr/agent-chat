import { normalizeUrl } from "../utils";
import { ResearchSearchResult } from "./modules/search";

/**
 * Curates a list of search results by removing duplicates and limiting the count.
 * Assumes the input `sources` are already sorted by relevance (e.g., by SearxNG).
 *
 * @param sources - Array of SearchResult objects from the search module
 * @param query - Original query string for relevance checking
 * @param maxResults - Maximum number of results to return
 * @returns Filtered array of SearchResult objects
 */
export async function curateSources(
  sources: ResearchSearchResult[],
  query: string,
  maxResults: number = 10
): Promise<ResearchSearchResult[]> {
  if (!sources || sources.length === 0) {
    return [];
  }

  // Step 1: Remove duplicates (by URL normalization)
  const uniqueSources = removeDuplicates(sources);
  console.log(
    `Deduplicated ${sources.length} sources down to ${uniqueSources.length} unique sources for query: "${query}"`
  );

  // Step 2: Slice the top N results (assuming input is sorted)
  const finalResults = uniqueSources.slice(0, maxResults);

  console.log(`Returning top ${finalResults.length} unique sources.`);

  return finalResults;
}

/**
 * Removes duplicate search results based on normalized URLs.
 *
 * @param sources - Array of SearchResult objects
 * @returns Array of unique SearchResult objects
 */
export function removeDuplicates(
  sources: ResearchSearchResult[]
): ResearchSearchResult[] {
  const seenUrls = new Set<string>();
  return sources.filter((source) => {
    // Normalize URL for comparison (remove trailing slashes, etc.)
    const normalizedUrl = normalizeUrl(source.url);

    if (seenUrls.has(normalizedUrl)) {
      return false;
    }

    seenUrls.add(normalizedUrl);
    return true;
  });
}
