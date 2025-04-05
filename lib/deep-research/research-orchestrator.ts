import { DataStreamWriter, generateText } from "ai";

import { SearchModule, ResearchSearchResult } from "./modules/search";
import { SourceCuratorModule } from "./modules/source-curator";
import { ContentScraperModule } from "./modules/content-scraper";
import { VectorStoreManager } from "./modules/vector-store-manager";
import { InsightGeneratorModule, Learning } from "./modules/insight-generator";
import { FactualVerificationModule } from "./modules/factual-verification";
import { ReportGeneratorModule } from "./modules/report-generator";
import { WorkflowConfig, ResearchOptions } from "./types";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { ModelsByCapability } from "../ai/models";
import { ScrapeResult } from "../search/types";

/**
 * Final research result
 */
export interface ResearchResult {
  query: string;
  insights: string[];
  factualAnswer: string;
  finalReport: string;
  sources: Record<string, string>;
  metrics: {
    timeElapsed: number;
    iterationsCompleted: number;
    sourcesExamined: number;
  };
  completedSteps: number;
  totalSteps: number;
}

// Constants for step calculation
const STEPS_PER_QUERY_ITERATION = 5; // Rough estimate: search, curate, scrape, vectorize, insight
const FINAL_REPORT_STEPS = 2; // verify, report
const INITIAL_PLANNING_STEPS = 1; // For the _planInitialResearch step

/**
 * Central orchestrator for managing the deep research workflow.
 */
export class ResearchOrchestrator {
  private searchModule: SearchModule;
  private curatorModule: SourceCuratorModule;
  private scraperModule: ContentScraperModule;
  private vectorStore: VectorStoreManager;
  private insightModule: InsightGeneratorModule;
  private verificationModule: FactualVerificationModule;
  private reportModule: ReportGeneratorModule;
  private dataStream: DataStreamWriter | null;
  private llmProvider: OpenAICompatibleProvider<string, string, string>; // Store LLM provider for potential usage
  private models: ModelsByCapability; // Store model ID for potential usage
  private options: ResearchOptions; // Store research options

  /**
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param models - Model capabilities map
   * @param dataStream - Optional stream for progress updates
   * @param options - Optional research configuration options
   */
  constructor(
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    models: ModelsByCapability,
    dataStream: DataStreamWriter | null = null,
    options: ResearchOptions = {} // Add options parameter
  ) {
    // Store LLM provider and model ID
    this.llmProvider = llmProvider;
    this.models = models;
    this.dataStream = dataStream;
    this.options = options; // Store options

    this.searchModule = new SearchModule();
    this.curatorModule = new SourceCuratorModule(llmProvider, models.light);
    this.scraperModule = new ContentScraperModule();

    // Initialize vector store for semantic search and context retrieval
    this.vectorStore = new VectorStoreManager();

    // Initialize insight generation and connect to vector store
    this.insightModule = new InsightGeneratorModule(
      llmProvider,
      models.default,
      this.vectorStore
    );

    this.verificationModule = new FactualVerificationModule(
      llmProvider,
      models.light
    );
    this.reportModule = new ReportGeneratorModule(
      llmProvider,
      models.reasoning
    );
  }

  /**
   * Main method to run the deep research workflow.
   *
   * @param query - Research query to investigate
   * @param config - Workflow configuration
   * @returns Promise with research result
   */
  async runDeepResearchWorkflow(
    query: string,
    config: WorkflowConfig
  ): Promise<ResearchResult> {
    const startTime = Date.now();
    const timeLimit = config.timeout || 4.5 * 60 * 1000;

    const researchState = {
      allSources: {} as Record<string, string>,
      allLearnings: [] as Learning[], // Structured learnings with citations
      factualAnswer: "",
      currentDepth: 0,
      maxDepth: config.maxDepth,
      completedSteps: 0,
      totalSteps: 0,
      iterations: [] as Array<{
        query: string;
        context: string;
        insights: string[];
      }>,
      shouldContinue: true,
      researchQueue: [] as string[],
    };

    try {
      // --- Phase 0: Planning ---
      const initialSubQueries = await this._planInitialResearch(
        query,
        researchState
      );
      researchState.researchQueue = [...initialSubQueries];

      // Determine the first query to process
      let currentQuery = researchState.researchQueue.shift();
      if (!currentQuery) {
        console.warn("No initial sub-queries generated. Using original query.");
        currentQuery = query; // Use original query if planning yielded nothing
      }

      // Calculate initial total steps AFTER determining the first query
      researchState.totalSteps = this._calculateTotalSteps(
        researchState,
        !!currentQuery
      );

      // Send initial progress
      this.updateProgressInit(researchState);
      this.updateProgress(
        researchState,
        "activity-delta",
        `exploring ${
          researchState.researchQueue.length + (currentQuery ? 1 : 0)
        } angles.`
      );

      await this.vectorStore.clear();

      // --- Main Research Loop ---
      console.log(
        `Starting research loop check. Depth: ${researchState.currentDepth}/${
          researchState.maxDepth
        }, HaveQuery: ${!!currentQuery}, ShouldContinue: ${
          researchState.shouldContinue
        }, Time OK: ${Date.now() - startTime < timeLimit}`
      ); // Debug log

      while (
        researchState.currentDepth < researchState.maxDepth &&
        researchState.shouldContinue &&
        currentQuery && // Ensure we have a query to process
        Date.now() - startTime < timeLimit
      ) {
        researchState.currentDepth++; // Increment depth at the START of the loop iteration
        console.log(
          `--- Iteration Start: Depth ${
            researchState.currentDepth
          }, Query: ${currentQuery.substring(0, 50)}... ---`
        ); // Debug log

        this.updateProgress(
          researchState,
          "depth-delta",
          `Starting research depth ${researchState.currentDepth}/${
            researchState.maxDepth
          } for query: ${currentQuery.substring(0, 50)}...`
        );

        let iterationSuccessful = true; // Track if iteration completes useful work

        // --- Phase 1: Search & Curate ---
        const sourceResults = await this.retrieveAndCurateSources(
          currentQuery,
          researchState
        );
        if (sourceResults.length > 0) {
          researchState.completedSteps += 2; // Increment for successful search + curate
        } else {
          console.log(`No sources found for query: ${currentQuery}`);
          iterationSuccessful = false;
          // Skip to next query if available
        }

        // --- Phase 2: Scrape ---
        let processedContents: ScrapeResult[] = [];
        if (iterationSuccessful) {
          processedContents = await this.scrapeAndConvertContent(
            sourceResults,
            researchState,
            query
          );
          if (processedContents.length > 0) {
            researchState.completedSteps++; // Increment for successful scrape
          } else {
            console.log(`No content scraped for query: ${currentQuery}`);
            iterationSuccessful = false;
            // Continue, might still generate insights from vector store later?
          }
        }

        // --- Phase 3: Vectorize ---
        let addedDocsCount = 0;
        if (iterationSuccessful && processedContents.length > 0) {
          // Only vectorize if scrape succeeded
          addedDocsCount = await this.addDocumentsToVectorStore(
            processedContents,
            researchState
          );
          if (addedDocsCount > 0) {
            researchState.completedSteps++; // Increment for successful vectorization
          }
        }

        // --- Phase 4: Generate Insights ---
        let insightResult: any = { learnings: [], followUpQuestions: [] };
        // Generate insights even if scrape/vectorize failed for this specific iter,
        // as vector store might have context from previous iterations.
        if (iterationSuccessful || researchState.allLearnings.length > 0) {
          // Check if *any* useful work done in loop or prev loops
          insightResult = await this.aggregateContextAndGenerateInsights(
            currentQuery,
            query,
            researchState
          );
          if (insightResult.learnings.length > 0) {
            researchState.completedSteps++; // Increment for successful insight generation
          }
          researchState.allLearnings.push(...insightResult.learnings);
          researchState.iterations.push({
            query: currentQuery,
            context: "",
            insights: insightResult.learnings.map((l: any) => l.text),
          }); // Simplified iteration tracking
        }

        // --- Queue Management & Recalculation ---
        const followUps = insightResult.followUpQuestions || [];
        let addedNewQuestions = false;
        if (followUps.length > 0) {
          const newQuestions = followUps.filter(
            (q: string) =>
              !researchState.researchQueue.includes(q) &&
              !researchState.iterations.some((iter) => iter.query === q)
          );
          if (newQuestions.length > 0) {
            researchState.researchQueue.unshift(...newQuestions.slice(0, 3));
            addedNewQuestions = true;
            researchState.totalSteps = this._calculateTotalSteps(
              researchState,
              !!currentQuery
            ); // Recalculate total steps
            this.updateProgress(
              researchState,
              "activity-delta",
              `Added ${newQuestions.length} new research angles. Total steps updated to ${researchState.totalSteps}`
            );
          }
        }

        // Get next query
        if (researchState.researchQueue.length > 0) {
          currentQuery = researchState.researchQueue.shift()!;
        } else {
          // Attempt variations only if we are not stopping
          if (
            researchState.currentDepth < researchState.maxDepth - 1 &&
            Date.now() - startTime < timeLimit * 0.9
          ) {
            const variations = this.generateQueryVariations(
              query,
              researchState.allLearnings.map(
                (learning: Learning) => learning.text
              )
            );
            if (variations.length > 0) {
              researchState.researchQueue.push(...variations);
              currentQuery = researchState.researchQueue.shift()!;
              researchState.totalSteps = this._calculateTotalSteps(
                researchState,
                true
              ); // Recalculate incl. new current query
              this.updateProgress(
                researchState,
                "activity-delta",
                `Generated ${variations.length} query variations. Total steps updated to ${researchState.totalSteps}`
              );
            } else {
              currentQuery = undefined; // No more variations
            }
          } else {
            currentQuery = undefined; // Stop if near depth/time limit
          }
        }

        if (!currentQuery) {
          this.updateProgress(
            researchState,
            "activity-delta",
            "Research queue empty, preparing final report."
          );
          researchState.shouldContinue = false; // Explicitly stop the loop
        }
        console.log(
          `--- Iteration End: Depth ${researchState.currentDepth} ---`
        ); // Debug log
      } // End while loop

      console.log("Research loop finished."); // Debug log

      // --- Phase 5: Factual verification ---
      this.updateProgress(
        researchState,
        "activity-delta",
        "Verifying factual accuracy..."
      );
      const verificationResult =
        await this.verificationModule.verifyFactualAccuracy(
          researchState.allLearnings,
          query
        );
      researchState.factualAnswer = verificationResult;
      researchState.completedSteps++; // Increment for verification step

      // --- Phase 6: Report generation ---
      this.updateProgress(
        researchState,
        "activity-delta",
        "Generating final report..."
      );
      const finalReport = await this.reportModule.generateFinalReport(
        researchState.allLearnings,
        query
      );
      researchState.completedSteps++;

      // Set final totalSteps accurately
      researchState.totalSteps = researchState.completedSteps;

      this.updateProgress(researchState, "complete", `Research complete.`);

      const result: ResearchResult = {
        query,
        insights: researchState.allLearnings.map(
          (learning: Learning) => learning.text
        ),
        factualAnswer: researchState.factualAnswer,
        finalReport: finalReport,
        sources: researchState.allSources,
        metrics: {
          timeElapsed: Date.now() - startTime,
          iterationsCompleted: researchState.currentDepth,
          sourcesExamined: Object.keys(researchState.allSources).length,
        },
        completedSteps: researchState.completedSteps,
        totalSteps: researchState.totalSteps, // Use the final accurate count
      };
      return result;
    } catch (error) {
      console.error("Error in deep research workflow:", error);
      // Ensure final steps reflect reality even on error, if possible
      researchState.totalSteps =
        researchState.completedSteps > 0
          ? researchState.completedSteps
          : FINAL_REPORT_STEPS; // Best guess on error
      // ... (rest of error handling) ...
      return {
        /* ... partial/error result ... */
      } as ResearchResult;
    } finally {
      console.log(
        `Research finished. Completed Steps: ${researchState.completedSteps}, Total Steps: ${researchState.totalSteps}, Depth: ${researchState.currentDepth}`
      );
      // Cleanup logic if needed
    }
  }

  /**
   * Phase 1: Retrieves and curates sources based on the query.
   *
   * @param query - Research query
   * @param state - Current research state
   * @returns Promise with curated search results
   */
  private async retrieveAndCurateSources(
    query: string,
    state: any
  ): Promise<ResearchSearchResult[]> {
    this.updateProgress(
      state,
      "activity",
      `Searching & Curating sources for: ${query.substring(0, 30)}...`
    );

    // Check if we should use semantic variations for better coverage
    let searchResults: ResearchSearchResult[] = [];

    // If we have accumulated some insights, use them to enhance the search
    if (state.allLearnings.length > 0 && state.currentDepth > 1) {
      // Generate semantic variations of the query based on insights
      const queryVariations = this.generateQueryVariations(
        query,
        state.allLearnings.map((learning: Learning) => learning.text)
      );

      // Search with all variations and merge results
      this.updateProgress(
        state,
        "activity-delta",
        `Searching with ${queryVariations.length} query variations`
      );

      searchResults = await this.searchModule.searchMultiple(
        queryVariations,
        undefined, // no year filter
        5, // results per query
        true // remove duplicates
      );
    } else {
      // Standard search with just the single query
      searchResults = await this.searchModule.searchWeb(query);
    }

    // Track the sources
    searchResults.forEach((result) => {
      state.allSources[result.url] = result.title || result.url;
    });

    // Determine how many sources to curate based on depth
    // Deeper explorations can be more focused with fewer sources
    const maxResults = Math.max(10 - state.currentDepth, 3); // At least 3, decreasing with depth

    // Curate the sources
    const curatedResults = await this.curatorModule.curateSources(
      searchResults,
      query,
      maxResults
    );

    // The increments are now handled in the main loop after this function returns
    return curatedResults;
  }

  /**
   * Generates semantic variations of a query based on accumulated insights.
   *
   * @param query - Original query
   * @param insights - Array of insights from previous research
   * @returns Array of query variations
   */
  private generateQueryVariations(query: string, insights: string[]): string[] {
    // Always include the original query
    const variations = [query];

    // Extract key terms from insights (simple approach)
    const recentInsights = insights.slice(-3); // Use only the most recent insights

    // For each insight, create a query variation combining the original query with the insight
    recentInsights.forEach((insight) => {
      // Extract key phrases from the insight (simplified approach)
      const keyPhrases = this.extractKeyPhrases(insight);

      // Add variations that combine the query with key phrases
      keyPhrases.forEach((phrase) => {
        if (
          phrase.length > 5 &&
          !query.toLowerCase().includes(phrase.toLowerCase())
        ) {
          variations.push(`${query} ${phrase}`);
        }
      });
    });

    // Ensure we don't have too many variations
    return variations.slice(0, 5); // Limit to 5 variations
  }

  /**
   * Extracts key phrases from text (simplified approach).
   *
   * @param text - Text to extract phrases from
   * @returns Array of key phrases
   */
  private extractKeyPhrases(text: string): string[] {
    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    // Extract noun phrases (simplified approach - just take substantial segments)
    const phrases: string[] = [];

    for (const sentence of sentences) {
      // Remove common stop words and split by common separators
      const cleaned = sentence
        .replace(
          /\b(the|and|or|in|on|at|a|an|of|for|to|with|by|is|are|was|were)\b/gi,
          " "
        )
        .trim();

      const fragments = cleaned.split(/[,;:\(\)]/);

      // Add fragments that are substantial enough to be meaningful
      fragments.forEach((fragment) => {
        const trimmed = fragment.trim();
        if (
          trimmed.length > 10 &&
          trimmed.split(" ").length >= 2 &&
          trimmed.split(" ").length <= 5
        ) {
          phrases.push(trimmed);
        }
      });
    }

    return phrases;
  }

  /**
   * Phase 2: Scrapes and converts content from sources.
   *
   * @param sources - Curated search results
   * @param state - Current research state
   * @returns Promise with array of processed content
   */
  private async scrapeAndConvertContent(
    sources: ResearchSearchResult[],
    state: any,
    originalQuery: string
  ): Promise<ScrapeResult[]> {
    this.updateProgress(
      state,
      "activity",
      `Scraping ${sources.length} sources...`
    );

    const urlsToScrape = sources.map((source) => source.url);

    if (urlsToScrape.length === 0) {
      this.updateProgress(state, "activity-delta", "No URLs to scrape.");
      return [];
    }

    this.updateProgress(
      state,
      "activity",
      `Scraping content from ${urlsToScrape.length} sources...`
    );

    // Use the explicitly passed original query
    const queryToUse = originalQuery;
    const extractTopKChunks = this.options.extract_top_k_chunks;

    // Log if the query is missing (shouldn't happen now but good practice)
    if (!queryToUse) {
      this.updateProgress(
        state,
        "warning",
        "Original query is missing for scraping step."
      );
    }

    // Use the processUrls method from ContentScraperModule
    const results = await this.scraperModule.processUrls(
      urlsToScrape,
      queryToUse, // Pass the guaranteed original query
      extractTopKChunks // Pass the chunk parameter
    );

    // The increment is handled in the main loop after this function returns
    return results;
  }

  /**
   * Adds processed documents to the vector store.
   *
   * @param processedContents - Array of processed content objects.
   * @param state - Current research state.
   */
  private async addDocumentsToVectorStore(
    scrapeResults: ScrapeResult[], // Accept ScrapeResult array
    state: any
  ): Promise<number> {
    // Return count of added docs
    this.updateProgress(state, "activity", "Vectorizing content...");

    const documentsToAdd = [];

    for (const result of scrapeResults) {
      // Prioritize relevant chunks if they exist and are not empty
      const contentToUse =
        result.relevant_chunks && result.relevant_chunks.length > 0
          ? result.relevant_chunks.join("\n\n") // Join chunks
          : result.processed_content; // Fallback to full processed content

      // Only add if we have content to use
      if (result.success && contentToUse && contentToUse.trim()) {
        // Map to the structure expected by vectorStore.addDocuments
        documentsToAdd.push({
          url: result.url, // Use the url directly
          text: contentToUse, // Map pageContent to text
          metadata: {
            // Keep other metadata if needed by the store
            source: result.url,
            title: result.title,
            publishedDate: result.publishedDate,
            // Add other relevant metadata if needed
          },
        });
        // Also update the sources tracked in the state
        state.allSources[result.url] = result.title || result.url;
      } else if (!result.success) {
        this.updateProgress(
          state,
          "warning",
          `Skipping failed scrape for ${result.url}: ${result.error}`
        );
      } else {
        this.updateProgress(
          state,
          "warning",
          `Skipping ${result.url} due to empty content or lack of relevant chunks.`
        );
      }
    }

    let addedCount = 0;
    if (documentsToAdd.length > 0) {
      try {
        await this.vectorStore.addDocuments(documentsToAdd);
        addedCount = documentsToAdd.length;
      } catch (error) {
        this.updateProgress(
          state,
          "error",
          `Failed to add documents to vector store: ${(error as Error).message}`
        );
      }
    } else {
      this.updateProgress(
        state,
        "warning",
        "No valid content found to add to vector store."
      );
    }

    // The increment is handled in the main loop after this function returns based on addedCount
    return addedCount;
  }

  /**
   * Phase 4: Generates insights using vector store context.
   *
   * @param specificQuery - Current specific query being researched
   * @param originalQuery - Original research query
   * @param state - Current research state
   * @returns Object with answer, learnings, analysis, and follow-up questions
   */
  private async aggregateContextAndGenerateInsights(
    specificQuery: string,
    originalQuery: string,
    state: any
  ) {
    this.updateProgress(
      state,
      "activity",
      `Generating insights for: ${specificQuery.substring(0, 30)}...`
    );

    // Generate insights using the specific query via the enhanced insight module
    const insightResult = await this.insightModule.generateInsights(
      specificQuery,
      originalQuery
    );

    // The increment is handled in the main loop after this function returns
    return insightResult;
  }

  /**
   * Reformulates a query when it doesn't yield good results.
   *
   * @param query - Original query
   * @param state - Current research state
   * @returns Reformulated query
   */
  private reformulateQuery(query: string, state: any): string {
    // Simple reformulation - could be expanded with LLM-based reformulation
    const prefixes = [
      "latest research on",
      "detailed information about",
      "comprehensive guide to",
      "expert analysis of",
      "current understanding of",
    ];

    // Get a prefix we haven't used yet
    const usedQueries = state.iterations.map((i: any) => i.query);
    const availablePrefixes = prefixes.filter(
      (p) => !usedQueries.some((q: string) => q.startsWith(p))
    );

    if (availablePrefixes.length > 0) {
      const prefix = availablePrefixes[0];
      return `${prefix} ${query}`;
    }

    // If all prefixes used, just return original
    return query;
  }

  /**
   * Updates progress through the data stream.
   *
   * @param state - Current research state
   * @param type - Type of update
   * @param message - Progress message
   */
  private updateProgress(state: any, type: string, message: string): void {
    if (!this.dataStream) {
      return;
    }

    const payload = {
      type,
      content: {
        message,
        current: state.currentDepth,
        max: state.maxDepth,
        completedSteps: state.completedSteps,
        totalSteps: state.totalSteps, // Send the latest calculated total
        timestamp: new Date().toISOString(),
      },
    };

    // Add specific log for depth delta
    if (type === "depth-delta") {
      console.log(
        "[Orchestrator] Sending depth-delta:",
        JSON.stringify(payload)
      );
    }

    this.dataStream.writeData(payload);
  }

  /**
   * Calculates the estimated total steps.
   * Simpler version focusing on completed + current + queue + final.
   */
  private _calculateTotalSteps(
    state: any,
    includeCurrentQueryEstimate = false
  ): number {
    const stepsPerIteration = STEPS_PER_QUERY_ITERATION;
    const currentDepth = state.currentDepth; // Get current depth

    // Estimate steps for the query currently being processed (if applicable)
    const currentQuerySteps = includeCurrentQueryEstimate
      ? stepsPerIteration
      : 0;

    // Estimate steps for remaining items in the queue ONLY during early depths
    const remainingQueueSteps =
      currentDepth < 2 // Only estimate queue steps for depth 0 and 1
        ? state.researchQueue.length * stepsPerIteration
        : 0; // Stop estimating queue steps after depth 1

    // Base calculation: Completed + Current (optional) + Queue (conditional) + Final
    const calculatedTotal =
      state.completedSteps +
      currentQuerySteps +
      remainingQueueSteps +
      FINAL_REPORT_STEPS;

    // Ensure total is always at least completed + final steps
    const minimumSteps = state.completedSteps + FINAL_REPORT_STEPS;

    console.log(
      `[_calculateTotalSteps] Depth: ${currentDepth}, Completed: ${state.completedSteps}, CurrentQ: ${currentQuerySteps}, QueueEst: ${remainingQueueSteps}, Final: ${FINAL_REPORT_STEPS} => Max(${calculatedTotal}, ${minimumSteps})`
    );

    return Math.max(calculatedTotal, minimumSteps);
  }

  /**
   * Plans the initial research by generating diverse subqueries to explore.
   *
   * @param query - Main research query
   * @param state - Current research state
   * @returns Promise with array of generated subqueries
   */
  private async _planInitialResearch(
    query: string,
    state: any
  ): Promise<string[]> {
    this.updateProgress(
      state,
      "activity-delta",
      "Planning research strategy..."
    );

    // Optional: Perform a quick preliminary search for context
    let prelimContext = "";
    try {
      const preliminarySearchResults = await this.searchModule.searchWeb(query);
      if (preliminarySearchResults.length > 0) {
        state.completedSteps++; // Only increment if search actually ran and returned something
      }
      const topResults = preliminarySearchResults.slice(0, 3);
      if (topResults.length > 0) {
        prelimContext =
          "Based on initial search results:\n" +
          topResults
            .map((r) => `- ${r.title || r.url}: ${r.snippet || "No snippet"}`)
            .join("\n");
      }
    } catch (searchError) {
      console.warn(
        "Preliminary search failed, planning without context:",
        searchError
      );
    }

    const planningPrompt = `You are a research strategist planning a comprehensive investigation on the topic: "${query}".

${prelimContext}

Generate 3-5 specific sub-queries or research angles that will help explore this topic thoroughly. 
These should cover different aspects, perspectives, or dimensions of the main query.
The sub-queries should be diverse and complementary, not redundant.

Return ONLY a JSON array of strings, with each string being a clear, searchable sub-query.
Example: ["First specific sub-query", "Second specific sub-query", "Third specific sub-query"]`;

    try {
      // Use a direct LLM call with the planning prompt
      const result = await generateText({
        model: this.llmProvider.chatModel(this.models.reasoning),
        prompt: planningPrompt,
      });

      // Parse the response to extract the JSON array
      try {
        // Try to parse the JSON array
        let subQueries: string[] = [];

        // Clean the response to extract just the JSON array
        const jsonText = result.text
          .trim()
          .replace(/```json\s+/g, "")
          .replace(/\s+```/g, "")
          .replace(/```/g, "");

        const parsedResult = JSON.parse(jsonText);

        // Validate that it's an array of strings
        if (
          Array.isArray(parsedResult) &&
          parsedResult.every((item) => typeof item === "string")
        ) {
          subQueries = parsedResult;
        } else {
          // If not a valid array of strings, fall back to the follow-up questions approach
          console.log(
            "LLM response was not a valid array of strings, falling back to insightModule"
          );
          const insightResult = await this.insightModule.generateInsights(
            prelimContext || query,
            query
          );
          subQueries = insightResult.followUpQuestions || [];
        }

        if (subQueries.length === 0) subQueries = [query]; // Fallback

        // Removed verbose progress update here
        return subQueries;
      } catch (parseError) {
        console.error("Error parsing planning LLM response:", parseError);
        console.log("Falling back to insightModule for research planning");

        // Fall back to the insight module approach if parsing fails
        const insightResult = await this.insightModule.generateInsights(
          prelimContext || query,
          query
        );

        // Use the follow-up questions as our sub-queries
        if (insightResult.followUpQuestions.length > 0) {
          this.updateProgress(
            state,
            "activity-delta",
            `Generated ${
              insightResult.followUpQuestions.length
            } research angles: ${insightResult.followUpQuestions.join(", ")}`
          );
          return insightResult.followUpQuestions;
        }

        // Last resort fallback
        return [query];
      }
    } catch (error) {
      console.error("Error during research planning:", error);
      this.updateProgress(state, "error", "Failed to plan research strategy.");
      return [query]; // Fallback to the original query
    }
  }

  /** Sends the initial progress update */
  private updateProgressInit(state: any): void {
    if (!this.dataStream) return;
    this.dataStream.writeData({
      type: "progress-init",
      content: {
        maxDepth: state.maxDepth,
        totalSteps: state.totalSteps, // Send initial estimate
      },
    });
  }
}
