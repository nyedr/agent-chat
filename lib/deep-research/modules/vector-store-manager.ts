import { cosineSimilarity } from "ai";

/**
 * Interface for a chunk of text with metadata
 */
export interface TextChunk {
  text: string;
  metadata: {
    url?: string;
    title?: string;
    type?: string;
    source?: string;
    [key: string]: any;
  };
}

/**
 * Interface for vector search result
 */
export interface VectorSearchResult {
  text: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * Simple text splitter for chunking documents
 */
class SimpleTextSplitter {
  constructor(
    private chunkSize: number = 1000,
    private chunkOverlap: number = 200
  ) {}

  /**
   * Split text into chunks with metadata
   *
   * @param text - Text to split into chunks
   * @param metadata - Metadata to attach to each chunk
   * @returns Array of document chunks with metadata
   */
  splitText(text: string, metadata: Record<string, any> = {}): TextChunk[] {
    if (!text || text.length <= 0) {
      return [];
    }

    // For short texts, just return as a single chunk
    if (text.length <= this.chunkSize) {
      return [{ text, metadata }];
    }

    const chunks: TextChunk[] = [];
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    let currentChunk = "";
    let currentPosition = 0;

    for (const paragraph of paragraphs) {
      // If adding this paragraph would exceed the chunk size and we already have content,
      // finish the current chunk and start a new one
      if (
        currentChunk.length + paragraph.length + 2 > this.chunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push({
          text: currentChunk,
          metadata: { ...metadata, position: currentPosition },
        });

        // Start new chunk with overlap - include the last bit of the previous chunk
        const overlapStart = Math.max(
          0,
          currentChunk.length - this.chunkOverlap
        );
        currentChunk =
          currentChunk.substring(overlapStart) + "\n\n" + paragraph;
        currentPosition += 1;
      } else {
        // Add paragraph to current chunk
        if (currentChunk.length > 0) {
          currentChunk += "\n\n";
        }
        currentChunk += paragraph;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        text: currentChunk,
        metadata: { ...metadata, position: currentPosition },
      });
    }

    return chunks;
  }
}

/**
 * In-memory vector store implementation with cosine similarity search
 */
class InMemoryVectorStore {
  private vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, any>;
    text: string;
  }> = [];

  /**
   * Add vectors to the store
   *
   * @param vectors - Array of vectors to add
   */
  addVectors(
    vectors: Array<{
      id: string;
      values: number[];
      metadata: Record<string, any>;
      text: string;
    }>
  ): void {
    this.vectors.push(...vectors);
  }

  /**
   * Search for similar vectors using cosine similarity
   *
   * @param queryVector - Query vector
   * @param limit - Maximum number of results
   * @returns Array of search results
   */
  search(queryVector: number[], limit: number = 5): VectorSearchResult[] {
    if (this.vectors.length === 0) {
      return [];
    }

    // Calculate cosine similarity scores
    const results = this.vectors
      .map((vector) => {
        const similarity = cosineSimilarity(queryVector, vector.values);
        return {
          text: vector.text,
          score: similarity,
          metadata: vector.metadata,
        };
      })
      // Sort by descending similarity score
      .sort((a, b) => b.score - a.score)
      // Take only the top results
      .slice(0, limit);

    return results;
  }

  /**
   * Remove all vectors from the store
   */
  clear(): void {
    this.vectors = [];
  }

  /**
   * Get the number of vectors in the store
   */
  get size(): number {
    return this.vectors.length;
  }
}

/**
 * VectorStoreManager for handling embeddings and semantic search
 */
export class VectorStoreManager {
  private vectorStore: InMemoryVectorStore;
  private textSplitter: SimpleTextSplitter;
  private embeddingEndpoint: string;

  /**
   * Create a new VectorStoreManager
   */
  constructor() {
    this.vectorStore = new InMemoryVectorStore();
    this.textSplitter = new SimpleTextSplitter(1000, 200);
    this.embeddingEndpoint =
      (process.env.PYTHON_SERVER_URL || "http://localhost:5328") +
      "/api/python/embed";
  }

  /**
   * Get embeddings for a list of texts
   *
   * @param texts - Array of texts to embed
   * @returns Promise with array of embeddings
   */
  async getEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }

    // Filter out any non-string or empty texts before sending
    const validTexts = texts.filter(
      (text) => typeof text === "string" && text.trim().length > 0
    );

    if (!validTexts.length) {
      console.warn("No valid texts provided for embedding.");
      return [];
    }

    try {
      console.log(
        `Calling Python embedding service directly for ${validTexts.length} texts: ${this.embeddingEndpoint}`
      );

      const response = await fetch(this.embeddingEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ texts: validTexts }), // Send only valid texts
      });

      if (!response.ok) {
        throw new Error(
          `Embedding API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error("Invalid response format from embedding API");
      }

      return data.embeddings;
    } catch (error) {
      console.error("Error generating embeddings:", error);
      throw error;
    }
  }

  /**
   * Add documents to the vector store
   *
   * @param documents - Array of documents to add
   * @returns Promise that resolves when documents are added
   */
  async addDocuments(
    documents: Array<{
      url: string;
      text: string;
      metadata?: Record<string, any>;
    }>
  ): Promise<void> {
    if (!documents.length) {
      return;
    }

    console.log(`Adding ${documents.length} documents to vector store`);

    // Extract chunks from documents
    const allChunks: TextChunk[] = [];

    for (const doc of documents) {
      // Ensure doc.text is a non-empty string before splitting
      if (
        !doc.text ||
        typeof doc.text !== "string" ||
        doc.text.trim().length === 0
      ) {
        console.warn(`Skipping document with invalid text: ${doc.url}`);
        continue;
      }

      try {
        // Split text into chunks with metadata
        const docChunks = this.textSplitter.splitText(doc.text, {
          url: doc.url,
          ...doc.metadata,
        });

        // Store each chunk
        for (const chunk of docChunks) {
          // Further validation: Ensure chunk text is valid before adding
          if (
            chunk.text &&
            typeof chunk.text === "string" &&
            chunk.text.trim().length >= 10
          ) {
            // Check length >= 10
            allChunks.push(chunk);
          }
        }
      } catch (error) {
        console.error(`Error splitting document ${doc.url}:`, error);
      }
    }

    if (!allChunks.length) {
      console.log("No valid chunks extracted from documents");
      return;
    }

    console.log(
      `Generated ${allChunks.length} chunks from ${documents.length} documents`
    );

    // Get embeddings for all chunks
    const chunkTexts = allChunks.map((chunk) => chunk.text);
    // We call getEmbeddings which already filters for valid text
    const embeddings = await this.getEmbeddings(chunkTexts);

    if (embeddings.length !== allChunks.length) {
      console.error(
        `Mismatch between chunks (${allChunks.length}) and embeddings (${embeddings.length})`
      );
      // This could happen if getEmbeddings filtered out some texts that were valid here
      return;
    }

    // Create vector objects for storage
    const vectors = allChunks.map((chunk, i) => ({
      id: `${chunk.metadata.url || "unknown"}-${i}`,
      values: embeddings[i],
      metadata: chunk.metadata,
      text: chunk.text,
    }));

    // Add vectors to the store
    this.vectorStore.addVectors(vectors);
    console.log(
      `Successfully indexed ${vectors.length} chunks (Total: ${this.vectorStore.size})`
    );
  }

  /**
   * Search for relevant documents
   *
   * @param query - Search query
   * @param k - Number of results to return
   * @returns Promise with array of search results
   */
  async search(query: string, k: number = 5): Promise<VectorSearchResult[]> {
    if (this.vectorStore.size === 0) {
      console.log("Vector store is empty");
      return [];
    }

    try {
      // Get embedding for the query
      const queryEmbedding = await this.getEmbeddings([query]);
      if (!queryEmbedding.length) {
        throw new Error("Failed to generate query embedding");
      }

      // Search for similar vectors
      const results = this.vectorStore.search(queryEmbedding[0], k);
      return results;
    } catch (error) {
      console.error("Error searching vector store:", error);
      return [];
    }
  }

  /**
   * Clear the vector store
   */
  async clear(): Promise<void> {
    this.vectorStore.clear();
  }

  /**
   * Get the number of vectors in the store
   */
  get size(): number {
    return this.vectorStore.size;
  }
}
