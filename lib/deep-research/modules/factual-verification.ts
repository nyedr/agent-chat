import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { VerificationResult } from "../types";
import { Learning } from "./insight-generator";

/**
 * Factual Verification Module that checks the accuracy of generated answers.
 */
export class FactualVerificationModule {
  private llmProvider: OpenAICompatibleProvider<string, string, string>;
  private modelId: string;

  /**
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param modelId - ID of the model to use for verification
   */
  constructor(
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    modelId: string
  ) {
    this.llmProvider = llmProvider;
    this.modelId = modelId;
  }

  /**
   * Verifies the factual accuracy of research findings against the original query.
   * Overload for structured Learnings format.
   *
   * @param learnings - Array of structured learnings with citations
   * @param originalQuery - The original research query
   * @returns Promise with verified factual answer
   */
  async verifyFactualAccuracy(
    learnings: Learning[],
    originalQuery: string
  ): Promise<string>;

  /**
   * Verifies the factual accuracy of research findings against the original query.
   * Legacy format for string-based findings.
   *
   * @param findings - Consolidated research findings as a string
   * @param originalQuery - The original research query
   * @returns Promise with verified factual answer
   */
  async verifyFactualAccuracy(
    findings: string,
    originalQuery: string
  ): Promise<string>;

  /**
   * Implementation of verifyFactualAccuracy that handles both overloads.
   */
  async verifyFactualAccuracy(
    findingsOrLearnings: string | Learning[],
    originalQuery: string
  ): Promise<string> {
    try {
      // Format findings based on input type
      let formattedFindings: string;

      if (Array.isArray(findingsOrLearnings)) {
        // It's an array of Learning objects
        formattedFindings = findingsOrLearnings
          .map((learning, index) => {
            return `[${index + 1}] ${learning.text}\nSource: ${
              learning.source
            }`;
          })
          .join("\n\n");
      } else {
        // It's a string
        formattedFindings = findingsOrLearnings;
      }

      // Create a prompt for verification
      const prompt = `As a fact-checker and research analyst, your task is to verify the factual accuracy of 
the following research findings related to the query: "${originalQuery}".

Research findings:
"""
${formattedFindings}
"""

Please:
1. Identify the key factual claims made in the findings
2. Assess the internal consistency of these claims
3. Note any claims that seem questionable, contradictory, or would require additional verification
4. Provide a factually accurate summary that addresses the original query

Focus on producing a well-reasoned, factually sound answer that accurately represents the research 
while avoiding speculation or unsubstantiated claims.

Your response should be a clear, concise summary in markdown format that prioritizes factual accuracy.`;

      // Generate verified answer using LLM
      const result = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt,
      });

      return result.text;
    } catch (error) {
      console.error("Error in factual verification:", error);

      // Create a fallback response
      let fallbackText: string;

      if (Array.isArray(findingsOrLearnings)) {
        fallbackText = findingsOrLearnings
          .map((learning) => learning.text)
          .join("\n\n");
      } else {
        fallbackText = findingsOrLearnings;
      }

      return `# Factual Assessment\n\nThe research findings contain valuable information, but could not be fully verified through automated fact-checking. Please review sources directly for confirmation of key claims.\n\n${fallbackText.substring(
        0,
        500
      )}...`;
    }
  }

  /**
   * Verifies the factual accuracy of an answer against ground truth data.
   *
   * @param answer - The answer to verify
   * @param groundTruth - Optional ground truth for comparison
   * @returns Promise with verification result
   */
  async verifyAnswer(
    answer: string,
    groundTruth?: string
  ): Promise<VerificationResult> {
    try {
      // If no ground truth is provided, perform a self-consistency check
      if (!groundTruth) {
        return this.performSelfConsistencyCheck(answer);
      }

      // Otherwise, compare against provided ground truth
      return this.compareWithGroundTruth(answer, groundTruth);
    } catch (error) {
      console.error("Error in factual verification:", error);
      return {
        isCorrect: false,
        explanation: "An error occurred during factual verification.",
      };
    }
  }

  /**
   * Performs a self-consistency check on an answer using the LLM.
   *
   * @param answer - The answer to check
   * @returns Promise with verification result
   */
  private async performSelfConsistencyCheck(
    answer: string
  ): Promise<VerificationResult> {
    // Create a prompt for the verification check
    const prompt = `You are a critical fact-checker. Your task is to assess the factual accuracy 
of the following statement. Identify any claims that might be incorrect, unsubstantiated, 
or require qualification.

Statement to evaluate:
"""
${answer}
"""

First, break down the statement into individual claims.
Then, for each claim, assess its accuracy, providing your reasoning.
Finally, provide an overall assessment.

Respond in this JSON format:
{
  "claims": [
    {
      "claim": "The specific claim",
      "assessment": "accurate|inaccurate|uncertain",
      "explanation": "Reason for your assessment"
    }
    // Additional claims
  ],
  "overallAssessment": {
    "isCorrect": true/false,
    "explanation": "Summary explanation of your assessment",
    "suggestedRevision": "Optional. A more accurate version of the statement if needed"
  }
}`;

    // Call the LLM
    const result = await generateText({
      model: this.llmProvider.chatModel(this.modelId),
      prompt,
    });

    // Parse the response
    return this.parseVerificationResponse(result.text, answer);
  }

  /**
   * Compares an answer against provided ground truth.
   *
   * @param answer - The answer to verify
   * @param groundTruth - Ground truth for comparison
   * @returns Promise with verification result
   */
  private async compareWithGroundTruth(
    answer: string,
    groundTruth: string
  ): Promise<VerificationResult> {
    // Create a prompt for comparison
    const prompt = `You are a fact-checker comparing a generated answer to ground truth information. 
Assess the factual accuracy of the answer against the ground truth.

Answer to evaluate:
"""
${answer}
"""

Ground truth information:
"""
${groundTruth}
"""

First, identify the main claims made in the answer.
Then, for each claim, determine whether it is supported by the ground truth information.
Finally, provide an overall assessment.

Respond in this JSON format:
{
  "assessments": [
    {
      "claim": "The specific claim from the answer",
      "isSupported": true/false,
      "groundTruthReference": "The relevant ground truth that supports or contradicts this claim"
    }
    // Additional assessments
  ],
  "overallAssessment": {
    "isCorrect": true/false,
    "explanation": "Explanation of your assessment",
    "finalAnswer": "A corrected version of the answer based on ground truth"
  }
}`;

    // Call the LLM
    const result = await generateText({
      model: this.llmProvider.chatModel(this.modelId),
      prompt,
    });

    // Parse the response
    return this.parseVerificationResponse(result.text, answer);
  }

  /**
   * Parses the verification response from the LLM.
   *
   * @param response - Raw LLM response
   * @param originalAnswer - The original answer being verified
   * @returns Verification result
   */
  private parseVerificationResponse(
    response: string,
    originalAnswer: string
  ): VerificationResult {
    try {
      // Extract JSON from the response
      const jsonMatch =
        response.match(/```json\n([\s\S]*)\n```/) ||
        response.match(/```([\s\S]*)```/) ||
        response.match(/{[\s\S]*}/);

      const jsonString = jsonMatch
        ? jsonMatch[0].replace(/```json\n|```/g, "")
        : response;

      const parsedResponse = JSON.parse(jsonString);

      // Try to extract the overall assessment
      if (parsedResponse.overallAssessment) {
        const { isCorrect, explanation, finalAnswer, suggestedRevision } =
          parsedResponse.overallAssessment;

        // Build citations if available
        const citations: Record<string, string> = {};

        // Add individual claims/assessments as citations if available
        const claims =
          parsedResponse.claims || parsedResponse.assessments || [];
        if (Array.isArray(claims)) {
          claims.forEach((item: any, index: number) => {
            if (item.claim) {
              citations[`claim${index + 1}`] = item.claim;

              if (item.explanation) {
                citations[`evidence${index + 1}`] = item.explanation;
              } else if (item.groundTruthReference) {
                citations[`evidence${index + 1}`] = item.groundTruthReference;
              }
            }
          });
        }

        return {
          isCorrect: Boolean(isCorrect),
          explanation: explanation || "No detailed explanation provided.",
          finalAnswer: finalAnswer || suggestedRevision || originalAnswer,
          citations: Object.keys(citations).length > 0 ? citations : undefined,
        };
      }

      // Fallback if structure doesn't match expected format
      return {
        isCorrect: false,
        explanation: "Could not determine factual accuracy with confidence.",
        finalAnswer: originalAnswer,
      };
    } catch (error) {
      console.error("Error parsing verification response:", error);

      // Return conservative result on parse failure
      return {
        isCorrect: false,
        explanation:
          "Could not properly analyze the factual accuracy of the answer.",
        finalAnswer: originalAnswer,
      };
    }
  }
}
