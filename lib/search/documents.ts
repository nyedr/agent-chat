import axios from "axios";
import { htmlToText } from "html-to-text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Document } from "@langchain/core/documents";
import { PDFExtract, PDFExtractResult } from "pdf.js-extract";

type DocumentsFromLinksReturn = Document<{
  title: string;
  url: string;
}>[];

type ProcessedContent = {
  title: string;
  content: string[];
  publishedDate?: string;
};

/**
 * Extracts content from a list of URLs and returns them as Document objects
 */
export const getDocumentsFromLinks = async ({
  links,
}: {
  links: string[];
}): Promise<DocumentsFromLinksReturn> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    keepSeparator: false,
  });

  const docs: Document<{ title: string; url: string }>[] = [];

  // Process links in parallel
  await Promise.all(
    links.map(async (originalLink) => {
      // Normalize the link to ensure it has a protocol
      const link =
        originalLink.startsWith("http://") ||
        originalLink.startsWith("https://")
          ? originalLink
          : `https://${originalLink}`;

      try {
        // Fetch content with timeout protection
        const response = await axios.get(link, {
          responseType: "arraybuffer",
          timeout: 10000,
        });

        // Determine content type
        const contentType = response.headers["content-type"] || "";
        const isPdf =
          typeof contentType === "string" &&
          contentType.includes("application/pdf");

        // Process content based on type
        let processed: ProcessedContent;

        if (isPdf) {
          processed = await processPdf(response.data, splitter, link);
        } else {
          processed = await processHtml(response.data, splitter, link);
        }

        // Create and add documents from processed content
        const linkDocs = processed.content.map(
          (text: string) =>
            new Document({
              pageContent: text,
              metadata: {
                title: processed.title,
                url: link,
                ...(processed.publishedDate && {
                  publishedDate: processed.publishedDate,
                }),
              },
            })
        );

        docs.push(...linkDocs);
      } catch (error) {
        // Handle and log any errors
        const errorDoc = createErrorDocument(error, link);
        docs.push(errorDoc);
      }
    })
  );

  return docs;
};

/**
 * Process PDF content using pdf.js-extract
 */
async function processPdf(
  data: Buffer,
  splitter: RecursiveCharacterTextSplitter,
  link: string
): Promise<ProcessedContent> {
  try {
    // Create a new PDFExtract instance
    const pdfExtract = new PDFExtract();

    // Extract PDF content from buffer
    const result = await new Promise<PDFExtractResult | undefined>(
      (resolve, reject) => {
        pdfExtract.extractBuffer(data, {}, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      }
    );

    if (!result) {
      throw new Error("Failed to extract PDF content");
    }

    // Extract text content from all pages
    const textContent = result.pages
      .flatMap((page) => page.content.map((item) => item.str))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Get title from metadata if available
    const title =
      result.meta?.metadata?.["dc:title"] ||
      result.meta?.metadata?.title ||
      "PDF Document";

    // Split text for processing
    const splitText = await splitter.splitText(textContent);

    return {
      title,
      content: splitText,
    };
  } catch (error) {
    console.error(`Error parsing PDF from ${link}:`, error);
    throw new Error(
      `PDF parsing failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Process HTML content
 */
async function processHtml(
  data: Buffer,
  splitter: RecursiveCharacterTextSplitter,
  link: string
): Promise<ProcessedContent> {
  try {
    const htmlContent = Buffer.from(data).toString("utf8");

    // Extract text content with better handling of different elements
    const cleanText = htmlToText(htmlContent, {
      baseElements: { selectors: ["body"] }, // Try to process only the body
      selectors: [
        // Focus on semantic content tags
        { selector: "article" },
        { selector: "main" },
        { selector: "p" },
        // Keep headers, but maybe less important than paragraphs
        { selector: "h1", options: { uppercase: false } },
        { selector: "h2", options: { uppercase: false } },
        { selector: "h3", options: { uppercase: false } },
        // Ignore links completely
        { selector: "a", format: "skip" },
        // Ignore nav, header, footer explicitly
        { selector: "nav", format: "skip" },
        { selector: "header", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "aside", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
      ],
      wordwrap: false,
      preserveNewlines: true, // Preserve paragraph breaks
    })
      .replace(/(\r\n|\n|\r){2,}/gm, "\n\n") // Normalize multiple line breaks
      .replace(/\t/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const splitText = await splitter.splitText(cleanText);

    // Extract title from HTML with fallbacks
    const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1] : "";

    // If no title found, try h1
    if (!title) {
      const h1Match = htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
      title = h1Match ? h1Match[1].replace(/<[^>]+>/g, "") : link;
    }

    // Extract various date formats
    let publishedDate: string | undefined;

    return {
      title,
      content: splitText,
      publishedDate,
    };
  } catch (error) {
    console.error(`Error parsing HTML from ${link}:`, error);
    throw new Error(
      `HTML parsing failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Create an error document for failed requests
 */
function createErrorDocument(
  error: unknown,
  link: string
): Document<{ title: string; url: string }> {
  let errorMessage = "Unknown error";

  if (axios.isAxiosError(error)) {
    errorMessage = `Network error: ${error.message}${
      error.response ? ` (Status: ${error.response.status})` : ""
    }`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else {
    errorMessage = String(error);
  }

  console.error(`Failed to retrieve content from link: ${link}`, error);

  return new Document({
    pageContent: `Failed to retrieve content from link: ${link}. Error: ${errorMessage}`,
    metadata: {
      title: "Failed to retrieve content",
      url: link,
    },
  });
}
