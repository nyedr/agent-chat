import axios from "axios";

export const getSearxngApiEndpoint = () => process.env.SEARXNG_API_URL;

interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
  time_range?: "day" | "week" | "month" | "year";
}

export interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
  publishedDate?: string;
  score?: number;
}

interface SearxngAnswer {
  url: string | null;
  answer: string;
  template?: string;
  engine?: string;
}

interface SearxngApiResponse {
  results: SearxngSearchResult[];
  answers: SearxngAnswer[];
  suggestions: string[];
}

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions
): Promise<SearxngApiResponse> => {
  const searxngBaseURL = getSearxngApiEndpoint();

  if (!searxngBaseURL) {
    throw new Error("SEARXNG_API_URL environment variable is not set.");
  }

  const cleanedBaseURL = searxngBaseURL.replace(/\/$/, "");
  const searchPath = "/search"; // Define the path separately

  // Use URL constructor for robust path joining and query parameter handling
  const url = new URL(searchPath, cleanedBaseURL);
  url.searchParams.append("format", "json"); // Always append format=json
  url.searchParams.append("q", query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key as keyof SearxngSearchOptions];
      // Only append the parameter if the value is not null or undefined
      if (value !== null && value !== undefined) {
        if (Array.isArray(value)) {
          url.searchParams.append(key, value.join(","));
        } else {
          // Ensure value is converted to string before appending
          url.searchParams.append(key, String(value));
        }
      }
    });
  }

  const res = await axios.get<SearxngApiResponse>(url.toString());

  // Ensure answers and suggestions are always arrays, even if missing
  const results = res.data.results || [];
  const answers = res.data.answers || [];
  const suggestions = res.data.suggestions || [];

  return { results, answers, suggestions };
};
