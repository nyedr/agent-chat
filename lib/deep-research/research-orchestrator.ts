import { DataStreamWriter, generateText } from "ai";

import { SearchModule, ResearchSearchResult } from "./modules/search";
import { ContentScraperModule } from "./modules/content-scraper";
import { VectorStoreManager } from "./modules/vector-store-manager";
import { InsightGeneratorModule, Learning } from "./modules/insight-generator";
import { ReportGeneratorModule } from "./modules/report-generator";
import { WorkflowConfig, ResearchOptions } from "./types";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { ModelsByCapability } from "../ai/models";
import { ScrapeResult } from "../search/types";
import { curateSources } from "./utils";

/**
 * Final research result.
 */
export interface ResearchResult {
  query: string;
  insights: string[];
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
const STEPS_PER_QUERY_ITERATION = 4; // Search, Scrape, Vectorize, Insight
const FINAL_REPORT_STEPS = 1; // Report Generation

/**
 * Central orchestrator for managing the deep research workflow.
 */
export class ResearchOrchestrator {
  private searchModule: SearchModule;
  private scraperModule: ContentScraperModule;
  private vectorStore: VectorStoreManager;
  private insightModule: InsightGeneratorModule;
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
    this.scraperModule = new ContentScraperModule();

    // Initialize vector store for semantic search and context retrieval
    this.vectorStore = new VectorStoreManager();

    // Initialize insight generation and connect to vector store
    this.insightModule = new InsightGeneratorModule(
      llmProvider,
      models.default,
      this.vectorStore
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
    console.log(`Starting deep research for query: "${query}"`);
    const startTime = Date.now();
    const timeLimit = config.timeout || 4.5 * 60 * 1000;

    const researchState = {
      allSources: {} as Record<string, string>,
      allLearnings: [] as Learning[], // Structured learnings with citations
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
      originalQuery: query, // Store the original query
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
        console.log("No initial sub-queries generated. Using original query.");
        currentQuery = query; // Use original query if planning yielded nothing
      }

      // Calculate initial total steps AFTER determining the first query
      // No need to call _calculateTotalSteps here, updateProgressInit will do it
      // researchState.totalSteps = this._calculateTotalSteps(researchState, !!currentQuery);

      // Send initial progress (this will calculate initial steps)
      this.updateProgressInit(researchState);
      this.updateProgress(
        researchState,
        "activity-delta",
        `exploring ${
          researchState.researchQueue.length + (currentQuery ? 1 : 0)
        } angles.`
      );

      await this.vectorStore.clear(); // Clear previous vector store state

      // --- Main Research Loop ---
      while (
        researchState.currentDepth < researchState.maxDepth &&
        researchState.shouldContinue &&
        currentQuery &&
        Date.now() - startTime < timeLimit
      ) {
        researchState.currentDepth++; // Increment depth at the START of the loop iteration

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
          researchState.completedSteps++; // Increment for successful search+curation
          this.updateProgress(
            researchState,
            "activity-delta",
            `Curated ${sourceResults.length} sources.`
          );
        } else {
          // No sources found, skip rest of iteration for this query
          iterationSuccessful = false;
          this.updateProgress(
            researchState,
            "warning",
            `No sources found for query: ${currentQuery}.`
          );
        }

        // --- Phase 2: Scrape ---
        let processedContents: ScrapeResult[] = [];
        if (iterationSuccessful) {
          processedContents = await this.scrapeAndConvertContent(
            sourceResults,
            researchState,
            query // Pass originalQuery here
          );
          if (processedContents.length > 0) {
            researchState.completedSteps++; // Increment for successful scrape
            this.updateProgress(
              researchState,
              "activity-delta",
              `Scraped content from ${processedContents.length} sources.`
            );
          } else {
            // No content scraped, maybe still generate insights later?
            iterationSuccessful = false;
            this.updateProgress(
              researchState,
              "warning",
              `Failed to scrape any content for current query.`
            );
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
            this.updateProgress(
              researchState,
              "activity-delta",
              `Vectorized content from ${addedDocsCount} sources.`
            );
          } else {
            this.updateProgress(
              researchState,
              "warning",
              `No valid documents added to vector store.`
            );
          }
        }

        // --- Phase 4: Generate Insights ---
        let insightResult: any = { learnings: [], followUpQuestions: [] }; // Initialize for type safety
        // Always attempt insight generation if we have a vector store or previous learnings
        if (this.vectorStore || researchState.allLearnings.length > 0) {
          insightResult = await this.aggregateContextAndGenerateInsights(
            currentQuery,
            query, // Pass originalQuery here
            researchState
          );
          if (insightResult && insightResult.learnings.length > 0) {
            researchState.completedSteps++; // Increment for successful insight generation
            researchState.allLearnings.push(...insightResult.learnings);
            researchState.iterations.push({
              // Track queries and resulting insights
              query: currentQuery,
              context: "", // Not storing full context here
              insights: insightResult.learnings.map((l: Learning) => l.text),
            });
            this.updateProgress(
              researchState,
              "activity-delta",
              `Generated ${insightResult.learnings.length} insights.`
            );
          } else {
            // Log if no insights were generated for this query
            console.log(`No new insights generated for query: ${currentQuery}`);
            this.updateProgress(
              researchState,
              "warning",
              `No insights generated for query: ${currentQuery}.`
            );
          }
        } else {
          // Skip insight generation if scrape/vectorize failed AND no prior learnings exist
          console.log(
            `Skipping insight generation for query: ${currentQuery} due to lack of scraped content and prior context.`
          );
          this.updateProgress(
            researchState,
            "warning",
            `Skipping insight generation for ${currentQuery}.`
          );
          iterationSuccessful = false;
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
            researchState.researchQueue.unshift(...newQuestions.slice(0, 3)); // Add to front for depth-first feel
            addedNewQuestions = true;
            // _calculateTotalSteps will be called by the next updateProgress call
            this.updateProgress(
              researchState,
              "activity-delta",
              `Added ${newQuestions.length} new research angles.`
            );
          }
        }

        // Get next query
        if (researchState.researchQueue.length > 0) {
          currentQuery = researchState.researchQueue.shift()!;
        } else {
          currentQuery = undefined; // Stop if queue is empty
        }

        if (!currentQuery) {
          this.updateProgress(
            researchState,
            "activity-delta",
            "Research queue empty, preparing final report."
          );
          researchState.shouldContinue = false; // Explicitly stop the loop
        }
      } // End while loop

      console.log("Research loop finished.");

      // --- Final Report Generation ---
      this.updateProgress(
        researchState,
        "activity-delta",
        "Generating final report..."
      );
      const finalReport = await this.reportModule.generateFinalReport(
        researchState.allLearnings,
        query // TODO: Update ReportGeneratorModule to accept & use state.originalQuery for a more focused prompt
      );
      researchState.completedSteps++;

      // Set final totalSteps accurately BEFORE sending final update
      researchState.totalSteps = researchState.completedSteps;

      this.updateProgress(researchState, "complete", `Research complete.`);

      const result: ResearchResult = {
        query,
        insights: researchState.allLearnings.map(
          (learning: Learning) => learning.text
        ),
        finalReport: finalReport,
        sources: researchState.allSources,
        metrics: {
          timeElapsed: Date.now() - startTime,
          iterationsCompleted: researchState.currentDepth,
          sourcesExamined: Object.keys(researchState.allSources).length,
        },
        completedSteps: researchState.completedSteps,
        totalSteps: researchState.totalSteps, // Use final accurate total
      };
      return result;
    } catch (error: any) {
      console.error("Error during deep research workflow:", error);
      // Ensure final steps reflect reality even on error
      researchState.totalSteps =
        researchState.completedSteps > 0
          ? researchState.completedSteps
          : FINAL_REPORT_STEPS; // Use completed or 1
      // Send error update
      this.updateProgress(
        researchState,
        "error",
        `Error during research: ${error.message || error}`
      );
      // Return a partial/error result
      return {
        query,
        insights: researchState.allLearnings.map((l) => l.text),
        finalReport: `Error during research: ${error.message || error}`,
        sources: researchState.allSources,
        metrics: {
          timeElapsed: Date.now() - startTime,
          iterationsCompleted: researchState.currentDepth,
          sourcesExamined: Object.keys(researchState.allSources).length,
        },
        completedSteps: researchState.completedSteps,
        totalSteps: researchState.totalSteps, // Use final calculated total
      } as ResearchResult;
    } finally {
      console.log(
        `Research finished. Final state - Completed Steps: ${researchState.completedSteps}, Total Steps: ${researchState.totalSteps}, Depth: ${researchState.currentDepth}`
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
      // Query variation generation removed, just use the current query
      searchResults = await this.searchModule.searchWeb(query);
      this.updateProgress(
        state,
        "activity-delta",
        `Performing standard search for depth ${state.currentDepth}.`
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
    const curatedResults = await curateSources(
      searchResults,
      query,
      maxResults
    );

    // Incrementing completedSteps is handled in the main loop
    return curatedResults;
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
    originalQuery: string // Receive originalQuery
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
      queryToUse // Pass the guaranteed original query
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
      // Use the full processed content now that chunking is removed
      const contentToUse = result.processed_content;

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
        // Handle specific scrape failures reported by the backend
        this.updateProgress(
          state,
          "warning",
          `Skipping failed scrape for ${result.url}: ${
            result.error || "Unknown error"
          }`
        );
      } else if (!contentToUse || !contentToUse.trim()) {
        // Check specifically for empty content after successful scrape
        this.updateProgress(
          state,
          "warning",
          `Skipping ${result.url} due to empty processed content after successful scrape.`
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
    originalQuery: string, // Receive originalQuery
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
      originalQuery // Pass originalQuery
    );

    // The increment is handled in the main loop after this function returns
    return insightResult;
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

    // Recalculate total steps *before* sending the update
    // Pass true if queue is not empty OR if we are in the final report stage (type === 'complete')
    // This ensures the estimate includes the 'current' item being processed or the final step.
    const includeCurrentEstimate =
      state.researchQueue.length > 0 || type === "complete";
    const currentTotalSteps = this._calculateTotalSteps(
      state,
      includeCurrentEstimate
    );

    // Update state's totalSteps if it changed (optional, but good practice)
    // Avoid setting totalSteps during 'complete' as it should be final by then.
    if (type !== "complete") {
      state.totalSteps = currentTotalSteps;
    }

    const payload = {
      type,
      content: {
        message,
        current: state.currentDepth,
        max: state.maxDepth,
        completedSteps: state.completedSteps,
        // Send the state's totalSteps which was just updated,
        // UNLESS it's the 'complete' message, then send completedSteps as total.
        totalSteps:
          type === "complete" ? state.completedSteps : state.totalSteps,
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

    // Log all updates for debugging
    // console.log(`[Orchestrator] Sending Progress (${type}):`, JSON.stringify(payload));

    this.dataStream.writeData(payload);
  }

  /**
   * Calculates the estimated total steps based on dynamic averages and depth.
   */
  private _calculateTotalSteps(
    state: any,
    includeCurrentQueryEstimate = false
  ): number {
    // Configuration constants
    const FINAL_REPORT_STEPS = 1; // Report Generation is one final step
    const BASE_STEPS_PER_QUERY_ITERATION = 4; // Search, Scrape, Vectorize, Insight

    const completedSteps = state.completedSteps;
    const researchQueue = state.researchQueue;

    // --- Estimate Known Remaining Work ---
    // Number of queries currently waiting in the queue (+1 if we include the current one being processed/about to be)
    const knownRemainingQueries =
      researchQueue.length + (includeCurrentQueryEstimate ? 1 : 0);

    const estimatedStepsForKnownQueries =
      knownRemainingQueries * BASE_STEPS_PER_QUERY_ITERATION;

    // --- Total Calculation ---
    // Sum completed, estimated known remaining, and final report steps.
    const totalEstimatedSteps =
      completedSteps + estimatedStepsForKnownQueries + FINAL_REPORT_STEPS;

    // --- Minimum Bound ---
    // Ensure total steps is at least the number completed plus minimal required remaining steps.
    // Minimal remaining: 1 step per known query (if any) + final report steps.
    // If includeCurrentQueryEstimate is true, it means we are *about* to start one or are doing the final report, so min is 1.
    const minQueriesOrFinalStep = includeCurrentQueryEstimate ? 1 : 0;
    // Ensure we account for at least 1 step per *actual* queued item + the current/final step
    const minimumRequiredRemainingSteps =
      researchQueue.length + minQueriesOrFinalStep + FINAL_REPORT_STEPS;
    const minimumTotalSteps = completedSteps + minimumRequiredRemainingSteps;

    // Return the maximum of the calculated estimate and the minimum bound, rounded up.
    // Ensure it's at least completedSteps + 1 if we aren't done yet.
    const finalSteps = Math.max(
      minimumTotalSteps,
      Math.ceil(totalEstimatedSteps)
    );
    return Math.max(
      finalSteps,
      completedSteps + (FINAL_REPORT_STEPS > 0 ? 1 : 0)
    ); // Ensure it's at least completed + 1
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
      // Increment step ONLY if planning context search succeeded
      // This step wasn't explicitly counted before, let's add it if successful.
      // Note: This might make the BASE_STEPS_PER_QUERY_ITERATION slightly off if planning fails often.
      if (preliminarySearchResults.length > 0) {
        state.completedSteps++; // Increment here for successful planning search
        this.updateProgress(
          state,
          "activity-delta",
          `Gathered preliminary context.`
        );
      }
      const topResults = preliminarySearchResults.slice(0, 3);
      if (topResults.length > 0) {
        prelimContext =
          "Based on initial search results:\n" +
          topResults
            .map((r) => `- ${r.title || r.url}: ${r.content || "No snippet"}`)
            .join("\n");
      }
    } catch (searchError) {
      console.warn(
        "Preliminary search failed, planning without context:",
        searchError
      );
      // Do not increment completedSteps if search failed
      this.updateProgress(
        state,
        "warning",
        `Preliminary search failed during planning.`
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
          parsedResult.every((item) => typeof item === "string") &&
          parsedResult.length > 0 // Ensure non-empty array
        ) {
          subQueries = parsedResult;
        } else {
          // If not a valid array of strings or empty, fall back
          console.log(
            "LLM response was not a valid non-empty array of strings, falling back to insightModule"
          );
          // Don't use insight module here, just use original query as fallback
          subQueries = [query];
        }

        this.updateProgress(
          state,
          "activity-delta",
          `Planned ${subQueries.length} research angles.`
        );
        return subQueries;
      } catch (parseError) {
        console.error("Error parsing planning LLM response:", parseError);
        // Last resort fallback
        this.updateProgress(
          state,
          "warning",
          `Failed to parse planning results, using original query.`
        );
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

    // Calculate initial steps *before* sending the init message
    const initialTotalSteps = this._calculateTotalSteps(
      state,
      state.researchQueue.length > 0 // Include estimate if queue has items
    );
    state.totalSteps = initialTotalSteps; // Set initial state

    this.dataStream.writeData({
      type: "progress-init",
      content: {
        maxDepth: state.maxDepth,
        totalSteps: initialTotalSteps, // Send initial estimate
      },
    });
  }
}
