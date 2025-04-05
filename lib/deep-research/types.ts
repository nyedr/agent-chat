/**
 * Configuration for the deep research workflow
 */
export interface WorkflowConfig {
  /**
   * Maximum depth of research iterations
   */
  maxDepth: number;

  /**
   * Maximum tokens to use for context
   */
  maxTokens: number;

  /**
   * Optional timeout in milliseconds
   */
  timeout?: number;

  /**
   * Optional limit on concurrent operations
   */
  concurrencyLimit?: number;
}

/**
 * Verification result from fact checking
 */
export interface VerificationResult {
  /**
   * Whether the answer is factually correct
   */
  isCorrect: boolean;

  /**
   * Optional explanation for the verification result
   */
  explanation?: string;

  /**
   * Optional corrected or enhanced answer
   */
  finalAnswer?: string;

  /**
   * Optional citations for the answer
   */
  citations?: Record<string, string>;
}

// Define ReportType (can be refined later)
export enum ReportType {
  RESEARCH_REPORT = "research_report",
  RESOURCE_REPORT = "resource_report",
  OUTLINE_REPORT = "outline_report",
}

export interface ResearchOptions {
  rerankerConfig?: any;
  reportType?: ReportType;
  sources?: any[];
  maxIterations?: number;
  researchDepth?: "basic" | "comprehensive";
  extract_top_k_chunks?: number;
}

export interface ResearchAdapter {
  // ... existing code ...
}

/**
 * Represents the final output of the deep research workflow.
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
  completedSteps: number; // Actual steps completed during run
  totalSteps: number; // Total steps estimated/tracked during run
}
