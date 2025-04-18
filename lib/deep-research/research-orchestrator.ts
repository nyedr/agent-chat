import { DataStreamWriter } from "ai";

import { SearchModule } from "./modules/search";
import { ContentScraperModule } from "./modules/content-scraper";
import { VectorStoreManager } from "./modules/vector-store-manager";
import { InsightGeneratorModule, Learning } from "./modules/insight-generator";
import { ReportGeneratorModule } from "./modules/report-generator";
import {
  WorkflowConfig,
  ResearchOptions,
  ReportPlan,
  ResearchLogEntry,
  GapAnalysisResult,
  ResearchState,
  Gap,
} from "./types";
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { ModelsByCapability } from "../ai/models";
import { ScrapeResult } from "../search/types";
import { SearxngSearchResult } from "../search/searxng";
import { curateSources } from "./utils";
import { ProgressUpdater } from "./modules/progress-updater";
import { planInitialResearch } from "./modules/planner";
import {
  analyzeKnowledgeGaps,
  generateTargetedQueries,
} from "./modules/gap-analyzer";
import { rerankDocuments } from "../../app/(chat)/actions";

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
  logs: ResearchLogEntry[];
}

// Constants for step calculation
const FINAL_REPORT_STEPS = 1; // Report Generation
const PLANNING_STEP = 1;
const BASE_STEPS_PER_ITERATION = 5; // Search, Scrape, Vectorize, Insight, Gap Analysis + Query Gen

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
  private llmProvider: OpenAICompatibleProvider<string, string, string>;
  private models: ModelsByCapability;
  private options: ResearchOptions;
  private progressUpdater: ProgressUpdater;

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
    options: ResearchOptions = {}
  ) {
    // Store LLM provider and model ID
    this.llmProvider = llmProvider;
    this.models = models;
    this.dataStream = dataStream;
    this.options = options;

    this.searchModule = new SearchModule();
    this.scraperModule = new ContentScraperModule();

    // Initialize vector store for semantic search and context retrieval
    this.vectorStore = new VectorStoreManager();

    // Initialize insight generation and connect to vector store
    this.insightModule = new InsightGeneratorModule(
      llmProvider,
      models.light,
      this.vectorStore
    );

    this.reportModule = new ReportGeneratorModule(
      llmProvider,
      models.reasoning,
      options.deliverables ?? []
    );

    // Instantiate ProgressUpdater
    this.progressUpdater = new ProgressUpdater(dataStream);
  }

  // Add public getter for logs
  public getLogs(): ResearchLogEntry[] {
    return this.progressUpdater.logs;
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
    // Clear logs using ProgressUpdater
    this.progressUpdater.clearLogs();
    this.progressUpdater.addLogEntry(
      "thought",
      "pending",
      `Starting deep research workflow for query: "${query}"`
    );
    console.log(`Starting deep research for query: "${query}"`);
    const startTime = Date.now();
    const timeLimit = config.timeout || 4.5 * 60 * 1000;

    const researchState: ResearchState = {
      allSources: {} as Record<string, string>,
      allLearnings: [] as Learning[],
      currentDepth: 0,
      maxDepth: config.maxDepth,
      completedSteps: 0,
      totalSteps: 0,
      shouldContinue: true,
      researchQueue: [] as Gap[],
      originalQuery: query,
      reportPlan: null as ReportPlan | null,
      objectives: this.options.objectives ?? [],
      deliverables: this.options.deliverables ?? [],
    };

    // Function to calculate priority (can be customized)
    const objectiveSet = new Set(
      (this.options.objectives ?? []).map((o) => o.toLowerCase())
    );
    const calculatePriority = (gap: Gap): number => {
      // Estimate effort loosely based on gap text length (longer might require more specific search)
      const estimatedEffort = Math.max(1, gap.text.length / 50); // Arbitrary scaling, avoid division by zero
      // Priority = (Severity * Confidence) / Estimated Effort
      // Higher severity/confidence increase priority, longer text (higher effort) decreases it slightly
      const basePriority = (gap.severity * gap.confidence) / estimatedEffort;
      // Clamp priority to avoid extreme values, e.g., 0 to 10
      const clampedBase = Math.max(0, Math.min(basePriority, 10));
      // Boost priority if the gap text matches a user objective
      const boost = objectiveSet.has(gap.text.toLowerCase()) ? 5 : 0;
      return clampedBase + boost;
    };

    try {
      // --- Phase 0: Planning ---
      const reportPlan = await planInitialResearch(
        query,
        researchState,
        {
          llmProvider: this.llmProvider,
          models: this.models,
          searchModule: this.searchModule,
          addLogEntry: this.progressUpdater.addLogEntry.bind(
            this.progressUpdater
          ),
          updateProgress: this.progressUpdater.updateProgress.bind(
            this.progressUpdater
          ),
        },
        this.options.objectives,
        this.options.deliverables
      );
      researchState.reportPlan = reportPlan;
      researchState.completedSteps += PLANNING_STEP;

      // Initialize queue: objectives first, then LLM key questions
      researchState.researchQueue = [
        ...(this.options.objectives ?? []).map(
          (o): Gap => ({
            text: o,
            severity: 3, // High severity for explicit objectives
            confidence: 0.9, // High confidence we should address it
          })
        ),
        ...reportPlan.report_outline.map(
          (section): Gap => ({
            text: section.key_question,
            severity: 3, // Also high severity
            confidence: 0.8,
          })
        ),
      ];

      // Deduplicate queue based on lowercased text
      const uniqueGaps = new Map<string, Gap>();
      researchState.researchQueue.forEach((gap) => {
        const key = gap.text.toLowerCase();
        if (!uniqueGaps.has(key)) {
          uniqueGaps.set(key, gap);
        }
      });
      researchState.researchQueue = Array.from(uniqueGaps.values());

      // Calculate and assign priority to all gaps
      researchState.researchQueue.forEach(
        (gap) => (gap.priority = calculatePriority(gap))
      );
      // Sort the combined queue by priority
      researchState.researchQueue.sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
      );

      let currentGap: Gap | undefined = researchState.researchQueue.shift();

      if (!currentGap) {
        this.progressUpdater.addLogEntry(
          "plan",
          "warning",
          "Planning resulted in no key questions. Using original query.",
          researchState.currentDepth
        );
        console.warn(
          "Planning resulted in no key questions. Using original query."
        );
        currentGap = { text: query, severity: 3, confidence: 0.8 };
        currentGap.priority = calculatePriority(currentGap);
      }

      this.progressUpdater.updateProgressInit(
        researchState,
        BASE_STEPS_PER_ITERATION,
        PLANNING_STEP,
        FINAL_REPORT_STEPS
      );

      // Update progress AFTER init which sets the total steps
      // Log this as a thought
      this.progressUpdater.addLogEntry(
        "thought",
        "complete",
        `Starting research for "${reportPlan.report_title}" (${reportPlan.report_outline.length} sections planned).`,
        researchState.currentDepth
      );
      this.progressUpdater.updateProgress(
        researchState,
        "activity-delta",
        `Starting research for "${reportPlan.report_title}" (${reportPlan.report_outline.length} sections planned).`
      );

      await this.vectorStore.clear(); // Clear previous vector store state
      this.progressUpdater.addLogEntry(
        "vectorize",
        "complete",
        "Cleared vector store state.",
        researchState.currentDepth
      );

      // --- Main Research Loop ---
      while (
        researchState.currentDepth < researchState.maxDepth &&
        researchState.shouldContinue &&
        currentGap && // Check if there is a current gap to process
        Date.now() - startTime < timeLimit
      ) {
        researchState.currentDepth++; // Increment depth at the START of the loop iteration
        const currentDepth = researchState.currentDepth; // For logging
        const currentQueryText = currentGap.text; // Extract text for current processing

        this.progressUpdater.addLogEntry(
          "thought",
          "pending",
          `Starting iteration depth ${currentDepth}/${
            researchState.maxDepth
          } for query: ${currentQueryText.substring(0, 50)}...`,
          currentDepth
        );
        this.progressUpdater.updateProgress(
          researchState,
          "depth-delta",
          `Starting research depth ${currentDepth}/${
            researchState.maxDepth
          } for query: ${currentQueryText.substring(0, 50)}...`
        );

        let iterationSuccessful = true; // Track if iteration completes useful work

        // --- Phase 1: Search & Curate ---
        const sourceResults = await this.retrieveAndCurateSources(
          currentQueryText, // Use gap text
          researchState // retrieveAndCurateSources now handles logging using progressUpdater
        );
        if (sourceResults.length > 0) {
          researchState.completedSteps++; // Increment for successful search+curation
          // Logging is now handled within retrieveAndCurateSources via progressUpdater
        } else {
          // No sources found, skip rest of iteration for this query
          iterationSuccessful = false;
          // Logging is now handled within retrieveAndCurateSources via progressUpdater
        }

        // --- Phase 2: Scrape ---
        let processedContents: ScrapeResult[] = [];
        if (iterationSuccessful) {
          processedContents = await this.scrapeAndConvertContent(
            sourceResults,
            researchState, // scrapeAndConvertContent now handles logging using progressUpdater
            researchState.originalQuery // Pass originalQuery from state
          );
          if (processedContents.length > 0) {
            researchState.completedSteps++; // Increment for successful scrape
            // Logging handled within scrapeAndConvertContent via progressUpdater
          } else {
            // No content scraped, maybe still generate insights later?
            iterationSuccessful = false; // Mark as less successful if scrape failed
            // Logging handled within scrapeAndConvertContent via progressUpdater
          }
        }

        // --- Phase 3: Vectorize ---
        let addedDocsCount = 0;
        if (iterationSuccessful && processedContents.length > 0) {
          // Only vectorize if scrape succeeded
          addedDocsCount = await this.addDocumentsToVectorStore(
            processedContents,
            researchState // addDocumentsToVectorStore now handles logging using progressUpdater
          );
          if (addedDocsCount > 0) {
            researchState.completedSteps++; // Increment for successful vectorization
            // Logging handled within addDocumentsToVectorStore via progressUpdater
          } else {
            // Log handled within addDocumentsToVectorStore
            // Logging handled within addDocumentsToVectorStore via progressUpdater
          }
        }

        // --- Phase 4: Generate Insights ---
        let insightResult: any = { learnings: [], followUpQuestions: [] }; // Initialize for type safety
        // Always attempt insight generation if we have a vector store or previous learnings
        if (this.vectorStore || researchState.allLearnings.length > 0) {
          insightResult = await this.aggregateContextAndGenerateInsights(
            currentQueryText, // Use gap text
            researchState.originalQuery, // Pass originalQuery from state
            researchState // aggregateContextAndGenerateInsights now handles logging using progressUpdater
          );
          if (insightResult && insightResult.learnings.length > 0) {
            researchState.completedSteps++; // Increment for successful insight generation
            researchState.allLearnings.push(...insightResult.learnings);
            // Logging handled within aggregateContextAndGenerateInsights via progressUpdater
          } else {
            // Log if no insights were generated for this query
            console.log(
              `No new insights generated for query: ${currentQueryText}`
            );
            // Logging handled within aggregateContextAndGenerateInsights via progressUpdater
          }
        } else {
          // Skip insight generation if scrape/vectorize failed AND no prior learnings exist
          console.log(
            `Skipping insight generation for query: ${currentQueryText} due to lack of scraped content and prior context.`
          );
          // Use ProgressUpdater for logging
          this.progressUpdater.addLogEntry(
            "synthesis",
            "warning",
            `Skipping insight generation for query: ${currentQueryText} due to lack of scraped content.`,
            currentDepth
          );
          // Use ProgressUpdater for updating progress
          this.progressUpdater.updateProgress(
            // Send progress update
            researchState,
            "warning",
            `Skipping insight generation for ${currentQueryText}.`
          );
        }

        // --- Gap Analysis & Targeted Search ---
        const currentLearnings = insightResult.learnings || []; // Learnings from *this* iteration
        let gapAnalysisOutput: GapAnalysisResult = {
          is_complete: false,
          remaining_gaps: [],
        };

        // Only perform gap analysis if the insight generation produced learnings
        // Also check if currentQueryText exists (TypeScript safety)
        if (currentQueryText && currentLearnings.length > 0) {
          gapAnalysisOutput = await analyzeKnowledgeGaps(
            currentQueryText, // Use gap text
            currentLearnings,
            researchState,
            {
              llmProvider: this.llmProvider,
              models: this.models,
              addLogEntry: this.progressUpdater.addLogEntry.bind(
                this.progressUpdater
              ),
              updateProgress: this.progressUpdater.updateProgress.bind(
                this.progressUpdater
              ),
            }
          );
          researchState.completedSteps++; // Count gap analysis as a step
        } else if (currentQueryText) {
          // If no learnings, assume the question is not complete and needs initial info
          gapAnalysisOutput = {
            is_complete: false,
            remaining_gaps: [
              {
                text: `Need initial information for "${currentQueryText}"`,
                severity: 3,
                confidence: 0.8,
              } as Gap,
            ],
          };
          this.progressUpdater.addLogEntry(
            "analyze",
            "warning",
            `Skipping gap analysis for "${currentQueryText}" due to no new learnings.`,
            currentDepth
          );
          this.progressUpdater.updateProgress(
            // Send progress update
            researchState,
            "warning",
            `Skipping gap analysis due to no new learnings.`
          );
        }

        // --- Queue Management --- (Handles Gap objects and priority)
        if (
          currentGap && // Ensure we have the original gap context
          !gapAnalysisOutput.is_complete &&
          gapAnalysisOutput.remaining_gaps.length > 0
        ) {
          // Calculate priority for newly identified gaps
          gapAnalysisOutput.remaining_gaps.forEach(
            (gap) => (gap.priority = calculatePriority(gap))
          );

          // Sort identified gaps by priority (highest first)
          const sortedNewGaps = gapAnalysisOutput.remaining_gaps.sort(
            (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
          );

          const topNewGap = sortedNewGaps[0]; // Consider the highest priority *new* gap

          // Simple approach: Limit targeted searches overall within maxDepth
          if (researchState.currentDepth < researchState.maxDepth) {
            const targetedQueries = await generateTargetedQueries(
              topNewGap.text, // Use text from the highest priority new gap
              researchState.originalQuery,
              researchState,
              {
                llmProvider: this.llmProvider,
                models: this.models,
                addLogEntry: this.progressUpdater.addLogEntry.bind(
                  this.progressUpdater
                ),
                updateProgress: this.progressUpdater.updateProgress.bind(
                  this.progressUpdater
                ),
              }
            );
            if (targetedQueries.length > 0) {
              // Convert targeted query strings back into Gap objects for the queue
              const newGapObjects: Gap[] = targetedQueries.map((qText) => ({
                text: qText,
                severity: topNewGap.severity, // Inherit severity from parent gap? Or set high?
                confidence: 0.9, // High confidence as it's targeted
              }));
              // Assign priority to new gap objects
              newGapObjects.forEach(
                (gap) => (gap.priority = calculatePriority(gap))
              );

              researchState.completedSteps++; // Count query generation as a step
              researchState.totalSteps +=
                newGapObjects.length * BASE_STEPS_PER_ITERATION; // Update total based on *new* gaps
              console.log(
                `[Orchestrator] Added ${
                  newGapObjects.length
                } targeted queries for gap "${topNewGap.text.substring(
                  0,
                  30
                )}...\". New estimated total steps: ${researchState.totalSteps}`
              );

              // Add the new gap objects to the queue
              researchState.researchQueue.push(...newGapObjects);

              // Re-sort the entire queue by priority after adding new gaps
              researchState.researchQueue.sort(
                (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
              );
            } else {
              console.warn(
                "Failed to generate targeted queries for gap. Moving to next item in queue."
              );
            }
          } else {
            this.progressUpdater.addLogEntry(
              "analyze",
              "warning",
              `Max depth reached, cannot address gap: ${topNewGap.text}`,
              currentDepth
            );
            this.progressUpdater.updateProgress(
              // Send progress update
              researchState,
              "warning",
              `Max depth reached, cannot address gap: ${topNewGap.text}`
            );
          }
        } else if (currentGap) {
          // If gap analysis found the gap complete
          // Key question is complete (or no gaps identified), move to the next distinct key question.
          this.progressUpdater.addLogEntry(
            "analyze",
            "complete",
            `Key question "${currentGap.text.substring(
              0,
              50
            )}..." marked as complete.`,
            currentDepth
          );
          this.progressUpdater.updateProgress(
            // Send progress update
            researchState,
            "activity-delta",
            `Key question "${currentGap.text.substring(
              0,
              50
            )}..." marked as complete.`
          );
        }

        // Get next query for the *next* iteration (highest priority from sorted queue)
        if (researchState.researchQueue.length > 0) {
          currentGap = researchState.researchQueue.shift()!; // Dequeue highest priority
          this.progressUpdater.addLogEntry(
            "thought",
            "pending",
            `Next query in queue (Priority: ${currentGap.priority?.toFixed(
              2
            )}): "${currentGap.text.substring(0, 50)}..."`,
            currentDepth
          );
        } else {
          currentGap = undefined; // No more gaps
          this.progressUpdater.addLogEntry(
            "thought",
            "complete",
            `Research queue empty.`,
            currentDepth
          );
        }

        if (!currentGap) {
          this.progressUpdater.updateProgress(
            // Send progress update
            researchState,
            "activity-delta",
            "Research queue empty, preparing final report."
          );
          researchState.shouldContinue = false; // Explicitly stop the loop
        }

        // Time/Depth check (Add explicit reason for stopping log)
        if (
          researchState.currentDepth >= researchState.maxDepth ||
          Date.now() - startTime >= timeLimit
        ) {
          researchState.shouldContinue = false;
          const reason =
            researchState.currentDepth >= researchState.maxDepth
              ? "max depth"
              : "time limit";
          this.progressUpdater.addLogEntry(
            "thought",
            "warning",
            `Stopping loop due to ${reason}.`,
            currentDepth
          );
          this.progressUpdater.updateProgress(
            // Send progress update
            researchState,
            "activity-delta",
            `Stopping loop due to ${reason}.`
          );
        }
      } // End while loop

      console.log("Research loop finished.");
      this.progressUpdater.addLogEntry(
        "thought",
        "complete",
        "Research loop finished."
      );

      // --- Final Report Generation ---
      this.progressUpdater.addLogEntry(
        "synthesis",
        "pending",
        "Generating final report...",
        researchState.currentDepth
      );
      this.progressUpdater.updateProgress(
        researchState,
        "activity-delta",
        "Generating final report..."
      );
      const finalReport = await this.reportModule.generateFinalReport(
        researchState.allLearnings,
        researchState.originalQuery,
        researchState.reportPlan,
        researchState.objectives
      );
      researchState.completedSteps++;
      this.progressUpdater.addLogEntry(
        "synthesis",
        "complete",
        "Final report generated.",
        researchState.currentDepth
      );

      this.progressUpdater.updateProgress(
        researchState,
        "complete",
        `Research complete.`
      );

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
        totalSteps: researchState.totalSteps,
        logs: this.progressUpdater.logs,
      };
      return result;
    } catch (error: any) {
      console.error("Error during deep research workflow:", error);
      this.progressUpdater.addLogEntry(
        "thought",
        "error",
        `Error during deep research workflow: ${error.message || error}`,
        researchState.currentDepth
      );
      // Ensure final steps reflect reality even on error
      researchState.totalSteps =
        researchState.completedSteps > 0
          ? researchState.completedSteps
          : FINAL_REPORT_STEPS; // Use completed or 1
      // Send error update
      this.progressUpdater.updateProgress(
        researchState,
        "error",
        `Error during research: ${error.message || error}`
      );
      // Return a partial/error result
      const errorResult: ResearchResult = {
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
        totalSteps: researchState.totalSteps,
        logs: this.progressUpdater.logs,
      };
      return errorResult;
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
    state: ResearchState
  ): Promise<SearxngSearchResult[]> {
    this.progressUpdater.addLogEntry(
      "search",
      "pending",
      `Searching web for: ${query.substring(0, 30)}...`,
      state.currentDepth
    );
    this.progressUpdater.updateProgress(
      state,
      "activity",
      `Searching & Curating sources for: ${query.substring(0, 30)}...`
    );

    // Extract potential site: hints from the query itself
    const hintedDomains =
      query.match(/site:([\w.-]+)/g)?.map((s) => s.replace("site:", "")) ?? [];
    if (hintedDomains.length > 0) {
      this.progressUpdater.addLogEntry(
        "search",
        "pending",
        `Extracted domain hints from query: ${hintedDomains.join(", ")}`,
        state.currentDepth
      );
    }

    let searchResults: SearxngSearchResult[] = [];

    // Call searchWeb with the extracted hints
    searchResults = await this.searchModule.searchWeb(
      query,
      15, // Default limit for searchWeb
      hintedDomains // Pass extracted domains
    );

    this.progressUpdater.addLogEntry(
      "search",
      "complete",
      `Initial search returned ${searchResults.length} results (including potential domain hints).`,
      state.currentDepth
    );

    // Track the sources
    searchResults.forEach((result) => {
      state.allSources[result.url] = result.title || result.url;
    });

    // Determine how many sources to curate based on depth
    // Deeper explorations can be more focused with fewer sources
    const maxResults = Math.max(15 - state.currentDepth, 5); // Increased base limit, At least 5, decreasing with depth

    // Curate the sources
    this.progressUpdater.addLogEntry(
      "search",
      "pending",
      `Reranking initial ${searchResults.length} sources...`,
      state.currentDepth
    );

    // 1. Prepare documents for reranker (needs id and text)
    const docsToRerank = searchResults.map((r, index) => ({
      id: r.url || `doc-${index}`, // Use URL as ID, fallback to index
      text: `${r.title || ""}\n${r.content || r.title || r.url || ""}`, // Combine title and content (if available) or just title/url for context
    }));

    // 2. Call the reranker
    let rerankedDocsResult: { id: string; text: string; score: number }[] = [];
    try {
      const rerankResponse = await rerankDocuments(
        query,
        docsToRerank,
        searchResults.length
      );
      rerankedDocsResult = rerankResponse.reranked_documents; // Extract the array
      console.log(
        `[Orchestrator] Reranked via actions.ts, got ${rerankedDocsResult.length} results.`
      );
    } catch (error) {
      console.error(`[Orchestrator] Reranking via actions.ts failed: ${error}`);
      // Keep rerankedDocsResult as empty array on error
    }

    // 3. Map reranked results back to SearxngSearchResult format for curation
    // Create a map for quick lookup of original search results by URL (ID)
    const searchResultMap = new Map(searchResults.map((r) => [r.url, r]));
    const rerankedSearchResults = rerankedDocsResult
      .map((reranked) => {
        const originalResult = searchResultMap.get(reranked.id);
        if (originalResult) {
          // Add the rerank score to the original result object
          return { ...originalResult, rerankScore: reranked.score };
        } else {
          // Should not happen if IDs match, but handle gracefully
          return null;
        }
      })
      .filter(
        (r): r is SearxngSearchResult & { rerankScore: number } => r !== null
      ); // Filter out nulls and type guard

    this.progressUpdater.addLogEntry(
      "search",
      "pending",
      `Curating top ${maxResults} sources from ${rerankedSearchResults.length} reranked results...`,
      state.currentDepth
    );

    // 4. Curate based on the reranked list
    const curatedResults = await curateSources(
      rerankedSearchResults, // Use reranked results
      query,
      maxResults,
      true // Add the flag back now that curateSources accepts it
    );
    // Logging completion handled in main loop

    // Incrementing completedSteps is handled in the main loop
    // Log completion status here now
    if (curatedResults.length > 0) {
      this.progressUpdater.addLogEntry(
        "search",
        "complete",
        `Curated ${curatedResults.length} relevant sources.`,
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
        state,
        "activity-delta",
        `Curated ${curatedResults.length} sources.`
      );
    } else {
      this.progressUpdater.addLogEntry(
        "search",
        "warning",
        `No sources found/curated for query: ${query}.`,
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
        state,
        "warning",
        `No sources found/curated for query: ${query}.`
      );
    }
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
    sources: SearxngSearchResult[],
    state: ResearchState,
    originalQuery: string // Receive originalQuery
  ): Promise<ScrapeResult[]> {
    this.progressUpdater.addLogEntry(
      "scrape",
      "pending",
      `Attempting to scrape ${sources.length} sources...`,
      state.currentDepth
    );
    this.progressUpdater.updateProgress(
      state,
      "activity",
      `Scraping ${sources.length} sources...`
    );

    const urlsToScrape = sources.map((source) => source.url);

    if (urlsToScrape.length === 0) {
      this.progressUpdater.addLogEntry(
        "scrape",
        "warning",
        "No URLs provided for scraping.",
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
        state,
        "activity-delta",
        "No URLs to scrape."
      );
      return [];
    }

    this.progressUpdater.addLogEntry(
      "scrape",
      "pending",
      `Processing ${urlsToScrape.length} URLs for content...`,
      state.currentDepth
    );
    this.progressUpdater.updateProgress(
      state,
      "activity",
      `Scraping content from ${urlsToScrape.length} sources...`
    );

    // Use the explicitly passed original query
    const queryToUse = originalQuery;

    // Log if the query is missing (shouldn't happen now but good practice)
    if (!queryToUse) {
      this.progressUpdater.addLogEntry(
        "scrape",
        "warning",
        "Original query is missing for scraping step.",
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
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
    // Log individual failures inside processUrls if possible, or summarize here
    const successes = results.filter((r) => r.success).length;
    const failures = results.length - successes;
    this.progressUpdater.addLogEntry(
      "scrape",
      failures > 0 ? "warning" : "complete",
      `Finished scraping ${results.length} URLs. Success: ${successes}, Failures: ${failures}.`,
      state.currentDepth
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
    scrapeResults: ScrapeResult[],
    state: ResearchState
  ): Promise<number> {
    this.progressUpdater.addLogEntry(
      "vectorize",
      "pending",
      `Preparing ${scrapeResults.length} scraped items for vectorization...`,
      state.currentDepth
    );
    this.progressUpdater.updateProgress(
      state,
      "activity",
      "Vectorizing content..."
    );

    const documentsToAdd = [];

    for (const result of scrapeResults) {
      const qualityScore = result.quality_score ?? 1.0;
      const qualityThreshold = 0.6;
      if (qualityScore < qualityThreshold) {
        const warnMsg = `Skipping ${
          result.url
        }: Low quality score (${qualityScore.toFixed(
          2
        )} < ${qualityThreshold}).`;
        this.progressUpdater.addLogEntry(
          "vectorize",
          "warning",
          warnMsg,
          state.currentDepth
        );
        this.progressUpdater.updateProgress(state, "warning", warnMsg);
        continue;
      }

      const contentToUse = result.processed_content;

      if (result.success && contentToUse && contentToUse.trim()) {
        documentsToAdd.push({
          url: result.url,
          text: contentToUse,
          metadata: {
            source: result.url,
            title: result.title,
            publishedDate: result.publishedDate,
            qualityScore: qualityScore,
          },
        });
        state.allSources[result.url] = result.title || result.url;
      } else if (!result.success) {
        const errorMsg = `Skipping ${result.url}: Scraping failed.`;
        this.progressUpdater.addLogEntry(
          "vectorize",
          "warning",
          errorMsg,
          state.currentDepth
        );
        this.progressUpdater.updateProgress(state, "warning", errorMsg);
      } else if (!contentToUse || !contentToUse.trim()) {
        const warnMsg = `Skipping ${result.url}: Empty content after scrape.`;
        this.progressUpdater.addLogEntry(
          "vectorize",
          "warning",
          warnMsg,
          state.currentDepth
        );
        this.progressUpdater.updateProgress(state, "warning", warnMsg);
      }
    }

    let addedCount = 0;
    if (documentsToAdd.length > 0) {
      this.progressUpdater.addLogEntry(
        "vectorize",
        "pending",
        `Adding ${documentsToAdd.length} processed documents to vector store...`,
        state.currentDepth
      );
      try {
        await this.vectorStore.addDocuments(documentsToAdd);
        addedCount = documentsToAdd.length;
        this.progressUpdater.addLogEntry(
          "vectorize",
          "complete",
          `Successfully added ${addedCount} documents to vector store.`,
          state.currentDepth
        );
        this.progressUpdater.updateProgress(
          state,
          "activity-delta",
          `Vectorized content from ${addedCount} sources.`
        );
      } catch (error) {
        this.progressUpdater.addLogEntry(
          "vectorize",
          "error",
          `Failed to add documents to vector store: ${
            (error as Error).message
          }`,
          state.currentDepth
        );
        this.progressUpdater.updateProgress(
          state,
          "error",
          `Failed to add documents to vector store: ${(error as Error).message}`
        );
      }
    } else {
      this.progressUpdater.addLogEntry(
        "vectorize",
        "warning",
        "No valid content found to add to vector store.",
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
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
    state: ResearchState
  ) {
    this.progressUpdater.addLogEntry(
      "synthesis",
      "pending",
      `Generating insights for: ${specificQuery.substring(0, 30)}...`,
      state.currentDepth
    );
    this.progressUpdater.updateProgress(
      state,
      "activity",
      `Generating insights for: ${specificQuery.substring(0, 30)}...`
    );

    // Generate insights using the specific query via the enhanced insight module
    const insightResult = await this.insightModule.generateInsights(
      specificQuery,
      originalQuery
    );
    // Logging handled in main loop based on result
    // Log completion/warning here now
    if (insightResult && insightResult.learnings.length > 0) {
      this.progressUpdater.addLogEntry(
        "synthesis",
        "complete",
        `Generated ${insightResult.learnings.length} insights.`,
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
        state,
        "activity-delta",
        `Generated ${insightResult.learnings.length} insights.`
      );
    } else {
      this.progressUpdater.addLogEntry(
        "synthesis",
        "warning",
        `No insights generated for query: ${specificQuery}.`,
        state.currentDepth
      );
      this.progressUpdater.updateProgress(
        state,
        "warning",
        `No insights generated for query: ${specificQuery}.`
      );
    }

    // The increment is handled in the main loop after this function returns
    return insightResult;
  }
}
