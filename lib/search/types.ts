/**
 * Represents a single processed result from the Python /scrape-process endpoint.
 */
export interface ScrapeResult {
  url: string;
  success: boolean;
  title?: string | null;
  publishedDate?: string | null;
  raw_content?: string | null; // Optional, for debugging
  quality_score?: number;
  processed_content?: string | null; // Content after quality filtering
  relevant_chunks?: string[] | null; // Currently null due to commented-out logic
  error?: string | null;
}

/**
 * Represents the overall response from the Python /scrape-process endpoint.
 */
export interface ScrapeProcessResponse {
  results: ScrapeResult[];
}

/**
 * Represents a single document reranked by the Python /rerank endpoint.
 */
export interface RerankedDocument {
  id: string; // Assuming ID is passed through, adjust if needed
  text: string;
  score: number;
}

/**
 * Represents the overall response from the Python /rerank endpoint.
 */
export interface RerankResponse {
  reranked_documents: RerankedDocument[];
}

/**
 * Represents a search result item enriched and ready for the UI and LLM.
 * This might consolidate info from initial search + scrape/process.
 */
export interface SearchResultItem {
  title: string;
  url: string;
  description?: string; // Initial description from search API
  source?: string;
  publishedDate?: string | null;
  favicon?: string;
  relevantContent?: string | null; // Content from scrape/process
  // Add other fields if needed, e.g., quality_score for debugging/display
}

/**
 * Represents the final response object from the TypeScript search tool execution.
 */
export interface SearchToolResponse {
  text: string; // Formatted text for LLM reasoning
  data: SearchResultItem[]; // Enriched data for UI
  query: string; // Original search query
  suggestions?: string[]; // Optional suggestions from search API
}
