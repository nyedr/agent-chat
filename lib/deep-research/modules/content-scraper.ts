import type FirecrawlApp from "@mendable/firecrawl-js";

/**
 * Interface for scraped content results
 */
export interface ScrapeResult {
  url: string;
  rawText: string;
  htmlContent: string;
  metadata: Record<string, any>;
}

/**
 * Interface for converted document results
 */
export interface ConvertedDocument {
  title?: string;
  text: string;
  metadata: Record<string, any>;
}

/**
 * Interface for processed content from any source
 */
export interface ProcessedContent {
  url: string;
  text: string;
  type: "web" | "pdf" | "docx" | "html" | "other";
  metadata: Record<string, any>;
}

/**
 * Content Scraper & Converter Module for extracting content from web pages
 * and converting documents.
 */
export class ContentScraperModule {
  private firecrawl: FirecrawlApp;
  private concurrencyLimit: number;
  private documentConversionEndpoint: string;

  /**
   * @param firecrawlApp - FirecrawlApp instance for web scraping
   * @param concurrencyLimit - Maximum number of concurrent scraping operations
   */
  constructor(firecrawlApp: FirecrawlApp, concurrencyLimit = 5) {
    this.firecrawl = firecrawlApp;
    this.concurrencyLimit = concurrencyLimit;
    this.documentConversionEndpoint =
      process.env.PYTHON_CONVERT_ENDPOINT_URL ||
      "http://localhost:5328/api/python/convert-document";
  }

  /**
   * Scrapes content from a list of URLs.
   *
   * @param urls - Array of URLs to scrape
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise with array of ProcessedContent objects
   */
  async scrapeUrls(
    urls: string[],
    timeout: number = 30000
  ): Promise<ProcessedContent[]> {
    // Filter out empty or invalid URLs
    const validUrls = urls.filter((url) => url && url.startsWith("http"));

    if (validUrls.length === 0) {
      return [];
    }

    console.log(`Processing ${validUrls.length} URLs for content extraction`);

    // Use the Semaphore pattern to limit concurrency
    const results: ProcessedContent[] = [];
    await this.runWithConcurrencyLimit(
      validUrls.map((url) => async () => {
        try {
          // Determine if this is a document URL or web page
          const urlType = this.detectUrlType(url);

          if (urlType === "web") {
            // Process as web page with Firecrawl
            const result = await this.scrapeSingleUrl(url, timeout);
            if (result) {
              // Convert ScrapeResult to ProcessedContent format
              results.push({
                url: result.url,
                text: result.rawText,
                type: this.detectContentType(url, result.metadata),
                metadata: result.metadata,
              });
            }
          } else {
            // Process as document using conversion endpoint
            console.log(`Processing ${url} as a ${urlType} document`);
            const documentContent = await this.callConvertEndpoint(
              url,
              timeout
            );

            if (documentContent) {
              results.push({
                url: url,
                text: documentContent.text,
                type: urlType,
                metadata: {
                  title: documentContent.title || url.split("/").pop() || "",
                  ...documentContent.metadata,
                  contentType: urlType,
                },
              });
            }
          }
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
        }
      })
    );

    console.log(
      `Successfully processed ${results.length} out of ${validUrls.length} URLs`
    );
    return results;
  }

  /**
   * Determines whether a URL points to a document or web page.
   *
   * @param url - URL to check
   * @returns Type of URL (web, pdf, docx, etc.)
   */
  private detectUrlType(
    url: string
  ): "web" | "pdf" | "docx" | "html" | "other" {
    const lowercaseUrl = url.toLowerCase();

    // Check file extensions in the URL
    if (lowercaseUrl.endsWith(".pdf")) return "pdf";
    if (lowercaseUrl.endsWith(".docx") || lowercaseUrl.endsWith(".doc"))
      return "docx";
    if (lowercaseUrl.endsWith(".html") || lowercaseUrl.endsWith(".htm"))
      return "html";
    if (
      lowercaseUrl.endsWith(".xlsx") ||
      lowercaseUrl.endsWith(".xls") ||
      lowercaseUrl.endsWith(".pptx") ||
      lowercaseUrl.endsWith(".ppt") ||
      lowercaseUrl.endsWith(".txt") ||
      lowercaseUrl.endsWith(".rtf") ||
      lowercaseUrl.endsWith(".md")
    )
      return "other";

    // Check for document-like patterns in the URL
    if (
      lowercaseUrl.includes("/download/") ||
      lowercaseUrl.includes("/document/") ||
      lowercaseUrl.includes("/pdf/") ||
      lowercaseUrl.includes("/documents/") ||
      lowercaseUrl.includes("/files/")
    ) {
      // If URL contains document-like patterns but we can't determine type,
      // we'll still process it as a web page to be safe
      if (lowercaseUrl.includes("pdf") || lowercaseUrl.includes("document")) {
        return "pdf"; // Guess PDF as most common document type
      }
    }

    return "web";
  }

  /**
   * Calls the document conversion endpoint to process a document URL.
   *
   * @param url - URL of the document to convert
   * @param timeout - Timeout in milliseconds
   * @returns Promise with converted document content
   */
  private async callConvertEndpoint(
    url: string,
    timeout: number
  ): Promise<ConvertedDocument | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Call the Python conversion service directly instead of going through the TS bridge
      const pythonServiceUrl = `${
        this.documentConversionEndpoint
      }?url=${encodeURIComponent(url)}`;
      console.log(
        `Calling Python document conversion service directly: ${pythonServiceUrl}`
      );

      const response = await fetch(pythonServiceUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Document conversion failed: ${response.status} ${response.statusText}`,
          errorText
        );
        return null;
      }

      const result = await response.json();

      if (!result.text) {
        console.error("Document conversion response missing text content");
        return null;
      }

      console.log(
        `Successfully converted document with ${result.text.length} characters`
      );

      return {
        title: result.title || "",
        text: result.text,
        metadata: result.metadata || {},
      };
    } catch (error: any) {
      if (error.name === "AbortError") {
        console.error(
          `Document conversion timed out after ${timeout}ms for ${url}`
        );
      } else {
        console.error(`Error converting document ${url}:`, error);
      }
      return null;
    }
  }

  /**
   * Scrapes content from a single URL.
   *
   * @param url - URL to scrape
   * @param timeout - Timeout in milliseconds
   * @returns Promise with ScrapeResult or null if scraping failed
   */
  private async scrapeSingleUrl(
    url: string,
    timeout: number
  ): Promise<ScrapeResult | null> {
    try {
      // Use promise with timeout
      const scrapePromise = this.firecrawl.scrapeUrl(url);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`Scraping ${url} timed out`)),
          timeout
        );
      });

      const scrapeResult: any = await Promise.race([
        scrapePromise,
        timeoutPromise,
      ]);

      if (!scrapeResult || !scrapeResult.success) {
        console.error(
          `Failed to scrape ${url}: ${scrapeResult?.error || "Unknown error"}`
        );
        return null;
      }

      // Extract metadata from the result
      const metadata: Record<string, any> = {};
      if (scrapeResult.title) {
        metadata.title = scrapeResult.title;
      }
      if (scrapeResult.siteName) {
        metadata.siteName = scrapeResult.siteName;
      }

      return {
        url,
        rawText: scrapeResult.markdown || scrapeResult.text || "",
        htmlContent: scrapeResult.html || "",
        metadata,
      };
    } catch (error) {
      console.error(`Error in scrapeSingleUrl for ${url}:`, error);
      return null;
    }
  }

  /**
   * Detects the content type based on URL and metadata
   *
   * @param url - URL of the content
   * @param metadata - Content metadata
   * @returns Content type string
   */
  private detectContentType(
    url: string,
    metadata: Record<string, any>
  ): "web" | "pdf" | "docx" | "html" | "other" {
    // Check metadata first
    if (metadata.contentType) {
      const contentType = metadata.contentType.toLowerCase();
      if (contentType.includes("pdf")) return "pdf";
      if (contentType.includes("docx") || contentType.includes("word"))
        return "docx";
      if (contentType.includes("html")) return "html";
    }

    // Check URL extension
    const urlLower = url.toLowerCase();
    if (urlLower.endsWith(".pdf")) return "pdf";
    if (urlLower.endsWith(".docx")) return "docx";
    if (urlLower.endsWith(".html") || urlLower.endsWith(".htm")) return "html";

    // Default to web
    return "web";
  }

  /**
   * Runs an array of async functions with concurrency limit.
   *
   * @param tasks - Array of async functions to execute
   */
  private async runWithConcurrencyLimit(
    tasks: Array<() => Promise<void>>
  ): Promise<void> {
    let activeTasks = 0;
    let taskIndex = 0;

    return new Promise((resolve) => {
      const runTask = async () => {
        if (taskIndex >= tasks.length) {
          if (activeTasks === 0) resolve();
          return;
        }

        const task = tasks[taskIndex++];
        activeTasks++;

        try {
          await task();
        } catch (error) {
          console.error("Task error:", error);
        }

        activeTasks--;
        runTask();
      };

      // Start initial batch of tasks up to concurrency limit
      const initialBatchSize = Math.min(this.concurrencyLimit, tasks.length);
      for (let i = 0; i < initialBatchSize; i++) {
        runTask();
      }
    });
  }
}
