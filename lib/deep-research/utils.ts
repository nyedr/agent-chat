import { normalizeUrl } from "../utils";
import { SearxngSearchResult } from "../search/searxng";

/**
 * Removes duplicate search results based on normalized URLs.
 *
 * @param sources - Array of SearchResult objects
 * @returns Array of unique SearchResult objects
 */
export function removeDuplicates(
  sources: SearxngSearchResult[]
): SearxngSearchResult[] {
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

export const QUALITY_DOMAINS = [
  "arxiv.org",
  "huggingface.co",
  "doi.org",
  "nih.gov",
  "openreview.net",
  "nature.com",
  "sciencemag.org",
  "plos.org",
  "pubmed.ncbi.nlm.nih.gov",
  "wikipedia.org",
  "un.org",
  "who.int",
  "*.edu",
  "*.gov",
  // Add more general-purpose authoritative domains here
];

const DOMAIN_QUALITY: Record<"high" | "medium" | "low", RegExp[]> = {
  high: [
    // Matches domain or subdomain
    /(\.|^)arxiv\.org$/,
    /(\.|^)doi\.org$/,
    /(\.|^)huggingface\.co$/,
    /(\.|^)nih\.gov$/,
    /(\.|^)openreview\.net$/,
    /(\.|^)nature\.com$/,
    /(\.|^)sciencemag\.org$/,
    /(\.|^)plos\.org$/,
    /(\.|^)pubmed\.ncbi\.nlm\.nih\.gov$/,
    /(\.|^)wikipedia\.org$/,
    /(\.|^)un\.org$/,
    /(\.|^)who\.int$/,
    /\.edu$/,
    /\.gov$/,
    // Add more high-quality patterns
  ],
  medium: [/(\.|^)medium\.com$/, /(\.|^)towardsdatascience\.com$/],
  low: [/(\.|^)blogspot\.com$/, /(\.|^)pinterest\.com$/],
};

function scoreDomain(url: string): number {
  try {
    const { hostname } = new URL(url);
    if (DOMAIN_QUALITY.high.some((r) => r.test(hostname))) return 3;
    if (DOMAIN_QUALITY.low.some((r) => r.test(hostname))) return 0.5;
    if (DOMAIN_QUALITY.medium.some((r) => r.test(hostname))) return 1;
  } catch (e) {
    console.warn(`[scoreDomain] Failed to parse URL: ${url}`, e);
  }
  return 1.2;
}

/**
 * Curates search results, removing duplicates and irrelevant content.
 *
 * @param searchResults - Raw search results
 * @param query - Original search query (for relevance check)
 * @param maxResults - Maximum number of results to return
 * @param isReranked - Optional flag indicating if the results are reranked
 * @returns Curated list of search results
 */
export function curateSources<T extends SearxngSearchResult>(
  searchResults: T[],
  query: string,
  maxResults: number,
  isReranked: boolean = false
): T[] {
  if (!searchResults || searchResults.length === 0) {
    return [];
  }

  const seenUrls = new Set<string>();
  const uniqueSources: T[] = [];

  for (const result of searchResults) {
    if (!result.url || seenUrls.has(result.url)) {
      continue;
    }
    // Basic relevance check (can be expanded)
    const titleLower = (result.title || "").toLowerCase();
    const contentLower = (result.content || "").toLowerCase();
    const queryLower = query.toLowerCase();
    // Simple keyword check - consider more advanced NLP later
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2); // Ignore short words
    const isRelevant = queryWords.some(
      (word) => titleLower.includes(word) || contentLower.includes(word)
    );

    // Added basic relevance check
    if (isRelevant) {
      seenUrls.add(result.url);
      uniqueSources.push(result);
    }
  }

  // Define the type for results that might have a rerank score
  type ScoredResult = T & { rerankScore?: number };

  // Sort based on whether input was reranked
  const scored = uniqueSources
    .map(
      (
        r: T
      ): {
        result: T;
        domainScore: number;
        searchScore: number;
        rerankScore?: number;
      } => ({
        result: r,
        domainScore: scoreDomain(r.url),
        searchScore: r.score ?? 0, // Use SearxNG score if available
        rerankScore: isReranked ? (r as ScoredResult).rerankScore : undefined, // Get rerank score if applicable
      })
    )
    .map((scoredItem) => {
      // --- Penalize deep URLs --- NEW STEP ---
      let finalDomainScore = scoredItem.domainScore;
      try {
        const pathSegments = new URL(scoredItem.result.url).pathname
          .split("/")
          .filter(Boolean);
        const depth = pathSegments.length;
        if (depth > 4) {
          const penalty = Math.min(0.5, (depth - 4) * 0.1); // Example: 0.1 penalty per level > 4, capped at 0.5
          finalDomainScore = Math.max(0, scoredItem.domainScore - penalty); // Apply penalty, ensure score >= 0
          // console.log(`[curateSources] Penalizing deep URL (${depth} levels): ${scoredItem.result.url}, Score ${scoredItem.domainScore} -> ${finalDomainScore}`);
        }
      } catch (e) {
        // Ignore URL parsing errors for penalty calculation
      }
      return { ...scoredItem, domainScore: finalDomainScore }; // Return item with potentially adjusted domainScore
    })
    .sort((a, b) => {
      if (
        isReranked &&
        a.rerankScore !== undefined &&
        b.rerankScore !== undefined
      ) {
        // Primary sort: Rerank Score (higher is better)
        if (b.rerankScore !== a.rerankScore) {
          return b.rerankScore - a.rerankScore;
        }
        // Fallback to domain score if rerank scores are equal
        if (b.domainScore !== a.domainScore) {
          return b.domainScore - a.domainScore;
        }
      } else {
        // Original sort: Domain Score (higher is better)
        if (b.domainScore !== a.domainScore) {
          return b.domainScore - a.domainScore;
        }
        // Secondary sort: SearxNG Score (higher is better)
        if (b.searchScore !== a.searchScore) {
          return b.searchScore - a.searchScore;
        }
      }
      // Final fallback if all else is equal (e.g., keep original relative order)
      return 0;
    })
    .slice(0, maxResults)
    .map((o) => o.result);

  return scored;
}
