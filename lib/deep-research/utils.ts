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
 * @returns Curated list of search results
 */
export function curateSources(
  searchResults: SearxngSearchResult[],
  query: string,
  maxResults: number
): SearxngSearchResult[] {
  if (!searchResults || searchResults.length === 0) {
    return [];
  }

  const seenUrls = new Set<string>();
  const uniqueSources: SearxngSearchResult[] = [];

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

  // Sort by domain quality score (desc), then by SearxNG score (desc)
  const scored = uniqueSources
    .map((r) => ({
      result: r,
      domainScore: scoreDomain(r.url),
      searchScore: r.score ?? 0, // Use SearxNG score if available
    }))
    .sort((a, b) => {
      // Primary sort: Domain Score (higher is better)
      if (b.domainScore !== a.domainScore) {
        return b.domainScore - a.domainScore;
      }
      // Secondary sort: SearxNG Score (higher is better)
      return b.searchScore - a.searchScore;
    })
    .slice(0, maxResults)
    .map((o) => o.result);

  return scored;
}
