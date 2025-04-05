import axios from "axios";

export const getSearxngApiEndpoint = () => process.env.SEARXNG_API_URL;

interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
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
  const searxngURL = getSearxngApiEndpoint();

  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append("q", query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key as keyof SearxngSearchOptions];
      if (Array.isArray(value)) {
        url.searchParams.append(key, value.join(","));
        return;
      }
      url.searchParams.append(key, value as string);
    });
  }

  const res = await axios.get<SearxngApiResponse>(url.toString());

  // Ensure answers and suggestions are always arrays, even if missing
  const results = res.data.results || [];
  const answers = res.data.answers || [];
  const suggestions = res.data.suggestions || [];

  return { results, answers, suggestions };
};
