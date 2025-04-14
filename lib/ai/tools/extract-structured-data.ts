import { DataStreamWriter, generateObject, tool } from "ai";
import { z } from "zod";
import fs from "fs/promises";
import { getValidatedPath } from "@/lib/utils";
import { myProvider } from "@/lib/ai/models";
import { scrapeAndProcessUrls } from "@/app/(chat)/actions";

interface ExtractStructuredDataProps {
  dataStream: DataStreamWriter;
  chatId?: string;
}

export interface ExtractStructuredDataToolResult {
  success: boolean;
  data?: any;
  schema?: string;
  source?: string;
  error?: string;
}

/**
 * Converts a schema string into a Zod schema object
 * @param schemaString JSON string representation of the schema
 * @returns Zod schema object
 */
function createDynamicSchema(schemaString: string): z.ZodTypeAny {
  try {
    // Parse the schema string into an object
    const schemaObj = JSON.parse(schemaString);

    // Initialize an empty object for Zod properties
    const zodProperties: Record<string, z.ZodTypeAny> = {};

    // Convert each property to its corresponding Zod type
    for (const [key, type] of Object.entries(schemaObj)) {
      switch (type) {
        case "string":
          zodProperties[key] = z.string().nullable();
          break;
        case "number":
          zodProperties[key] = z.number().nullable();
          break;
        case "boolean":
          zodProperties[key] = z.boolean().nullable();
          break;
        case "object":
          zodProperties[key] = z.record(z.any()).nullable();
          break;
        case "string[]":
          zodProperties[key] = z.array(z.string()).nullable();
          break;
        case "number[]":
          zodProperties[key] = z.array(z.number()).nullable();
          break;
        case "date":
        case "datetime":
          zodProperties[key] = z.string().nullable(); // Store dates as strings
          break;
        default:
          // Default to string for unknown types
          zodProperties[key] = z.string().nullable();
      }
    }

    // Create and return the Zod schema
    return z.object(zodProperties);
  } catch (error) {
    console.error("Error creating dynamic schema:", error);
    // Fallback to accepting any object if there's an error
    return z.record(z.any());
  }
}

export const extractDataFromContent = async ({
  schema,
  content,
  maxContentLength = 32000,
}: {
  schema: string;
  content: string;
  maxContentLength?: number;
}) => {
  const dynamicSchema = createDynamicSchema(schema);

  const truncatedContent =
    content.length > maxContentLength
      ? content.substring(0, maxContentLength) + "... [CONTENT TRUNCATED]"
      : content;

  try {
    // Generate the structured data using the dynamic schema
    const { object: extractedData } = await generateObject({
      model: myProvider.chatModel(process.env.NEXT_PUBLIC_DEFAULT_LIGHT_MODEL!),
      messages: [
        {
          role: "system",
          content: `You are a structured data extraction assistant. Your task is to extract structured data according to a schema.`,
        },
        {
          role: "user",
          content: `Extract structured data from the following content according to the schema below.

                SCHEMA:
                ${schema}

                CONTENT:
                ${truncatedContent}

                Extract and return a valid JSON object matching the schema. If you cannot extract certain fields, use null for those fields.`,
        },
      ],
      schema: dynamicSchema,
      schemaDescription: "Structured data extracted from content",
      temperature: 0.1,
      mode: "auto",
    });

    return extractedData;
  } catch (error) {
    console.error("Error extracting structured data:", error);
    throw error;
  }
};

export const extractStructuredData = ({
  dataStream,
  chatId,
}: ExtractStructuredDataProps) =>
  tool({
    description:
      "Extracts structured data (JSON) from either a URL's content or a file's content based on a provided schema.",
    parameters: z.object({
      url: z
        .string()
        .optional()
        .describe(
          "URL to scrape content from. Either url or filePath must be provided, but not both."
        ),
      filePath: z
        .string()
        .optional()
        .describe(
          "Relative path of a file in the chat's uploads directory to read. Either url or filePath must be provided, but not both."
        ),
      schema: z
        .string()
        .describe(
          "JSON schema defining the desired output structure. Provide as a string representation of a JSON object with properties and their types."
        ),
    }),
    execute: async ({
      url,
      filePath,
      schema,
    }): Promise<ExtractStructuredDataToolResult> => {
      try {
        // Validate inputs - need either url OR filePath, but not both or neither
        if ((!url && !filePath) || (url && filePath)) {
          return {
            success: false,
            error:
              "You must provide either a URL OR a file path, but not both or neither.",
          };
        }

        let content = "";
        let source = "";

        // Get content from either URL or file
        if (url) {
          source = `URL: ${url}`;
          dataStream.writeData({
            type: "extraction-status",
            content: JSON.stringify({
              status: "scraping",
              message: `Scraping content from ${url}...`,
            }),
          });

          // Use scrapeAndProcessUrls directly
          const scrapeResponse = await scrapeAndProcessUrls({
            urls: [url],
            crawlingStrategy: "http",
          });

          // Check if we got a result for the URL
          const scrapeResult = scrapeResponse.results[0];
          if (!scrapeResult || !scrapeResult.success || scrapeResult.error) {
            const errorMessage = scrapeResult?.error || "Failed to scrape URL";
            return {
              success: false,
              source,
              error: `Failed to scrape URL: ${errorMessage}`,
            };
          }

          content = scrapeResult.processed_content || "";
        } else if (filePath && chatId) {
          source = `File: ${filePath}`;
          dataStream.writeData({
            type: "extraction-status",
            content: JSON.stringify({
              status: "reading",
              message: `Reading content from ${filePath}...`,
            }),
          });

          // Read file directly instead of using the tool
          const validatedFilePath = getValidatedPath(chatId, filePath);
          if (!validatedFilePath) {
            return {
              success: false,
              source,
              error: "Invalid or unsafe file path specified.",
            };
          }

          try {
            content = await fs.readFile(validatedFilePath, "utf-8");
          } catch (readError: any) {
            let errorMsg = `Failed to read file: ${filePath}.`;
            if (readError.code === "ENOENT") {
              errorMsg = `File not found: ${filePath}`;
            } else if (readError.code === "EACCES") {
              errorMsg = `Permission denied reading file: ${filePath}`;
            } else {
              errorMsg = `Failed to read file: ${filePath}. ${readError.message}`;
            }

            return {
              success: false,
              source,
              error: errorMsg,
            };
          }
        } else {
          return {
            success: false,
            error: "Chat ID is required for file operations.",
          };
        }

        if (!content) {
          return {
            success: false,
            source,
            error: "No content found to extract data from.",
          };
        }

        // Stream status update
        dataStream.writeData({
          type: "extraction-status",
          content: JSON.stringify({
            status: "extracting",
            message: "Extracting structured data...",
          }),
        });

        const extractedData = await extractDataFromContent({
          schema,
          content,
        });

        // Stream the extracted data
        dataStream.writeData({
          type: "extraction-complete",
          content: JSON.stringify({
            data: extractedData,
            schema,
            source,
          }),
        });

        return {
          success: true,
          data: extractedData,
          schema,
          source,
        };
      } catch (error) {
        console.error("Error in structured data extraction:", error);
        return {
          success: false,
          error: `Extraction failed: ${(error as Error).message}`,
        };
      }
    },
  });
