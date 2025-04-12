import { SearchResultItem } from "./types";

export function formatSearchResults(results: SearchResultItem[]) {
  return results
    .map((result, i) => {
      let content = `[${i + 1}] "${result.title}" from ${result.source}\n${
        result.description || "No description available."
      }`;
      if (
        result.relevantContent &&
        !result.relevantContent.startsWith("Error processing:")
      ) {
        content += `\n\nRelevant content from page:\n${result.relevantContent}`;
      } else if (result.relevantContent) {
        content += `\n[Note: Error fetching/processing content for this source]`;
      }
      return content;
    })
    .join("\n\n");
}
