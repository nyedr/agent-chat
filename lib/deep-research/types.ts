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
