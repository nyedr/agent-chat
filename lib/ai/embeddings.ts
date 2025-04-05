import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { getEmbeddingsFromPython } from "@/app/(chat)/actions";

/**
 * A Langchain/AI SDK compatible Embeddings class that proxies requests
 * to the Python backend via a server action.
 */
export class PythonEmbeddings extends Embeddings {
  constructor(params?: EmbeddingsParams) {
    super(params ?? {});
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }
    try {
      return await getEmbeddingsFromPython(texts);
    } catch (error) {
      console.error("Error embedding documents via Python server:", error);
      throw error; // Re-throw to allow higher-level handling
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!text) {
      throw new Error("Cannot embed empty text.");
    }
    try {
      const embeddings = await getEmbeddingsFromPython([text]);
      if (embeddings.length === 0) {
        throw new Error("Python server returned no embedding for the query.");
      }
      return embeddings[0];
    } catch (error) {
      console.error("Error embedding query via Python server:", error);
      throw error; // Re-throw
    }
  }
}
