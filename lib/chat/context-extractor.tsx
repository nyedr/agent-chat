import { scrapeAndProcessUrls } from "@/app/(chat)/actions";
import { extractLinks, getFaviconUrl } from "../utils";
import { ScrapeResult, SearchResultItem } from "../search/types";
import { formatSearchResults } from "../search/utils";

interface ExtractedContext {
  context: string;
  links: string[];
  results: ScrapeResult[];
}

export const extractMessageContext = async (
  messageContent: string
): Promise<ExtractedContext | null> => {
  const links = extractLinks(messageContent);

  if (links.length === 0) {
    return null;
  }

  const { results } = await scrapeAndProcessUrls({ urls: links });

  const scrapedResults: SearchResultItem[] = results.map((result) => {
    return {
      title: result.title ?? "Untitled",
      url: result.url,
      description: result.processed_content ?? "",
      relevantContent: result.processed_content,
      source: result.url,
      favicon: getFaviconUrl(result.url),
      publishedDate: result.publishedDate,
    };
  });

  return {
    context: formatSearchResults(scrapedResults),
    links,
    results,
  };
};
