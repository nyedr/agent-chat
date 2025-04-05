import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { Learning } from "./insight-generator";

/**
 * Report Generator Module that creates a final research report using a single LLM call.
 */
export class ReportGeneratorModule {
  private llmProvider: OpenAICompatibleProvider<string, string, string>;
  private modelId: string;

  /**
   * Helper function to clean LLM markdown output.
   * Removes common wrapping like ```markdown ... ``` and trims whitespace.
   * Also removes specific unwanted labels like "Markdown".
   */
  private cleanLLMMarkdown(rawText: string): string {
    let cleaned = rawText.trim();
    // Remove markdown code fences (optional language specifier)
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/gm, "$1");
    // Remove specific labels (case-insensitive)
    cleaned = cleaned.replace(/^Markdown\s*$/gim, "");
    // Remove potential source lists injected inappropriately
    cleaned = cleaned.replace(/^sources:\s*{[\s\S]*?}\s*$/gim, "");
    return cleaned.trim();
  }

  /**
   * @param llmProvider - Provider for accessing LLM capabilities
   * @param modelId - ID of the model to use for report generation
   */
  constructor(
    llmProvider: OpenAICompatibleProvider<string, string, string>,
    modelId: string
  ) {
    this.llmProvider = llmProvider;
    this.modelId = modelId;
  }

  /**
   * Generates the final research report using a single LLM call.
   */
  async generateFinalReport(
    learnings: Learning[],
    query: string
  ): Promise<string> {
    console.log(
      `Generating full report for query: "${query}" with ${learnings.length} learnings (single call)`
    );

    // --- Create Source Map (URL -> {index: number, title?: string}) ---
    const uniqueSourcesMap = new Map<
      string,
      { index: number; title?: string }
    >();
    let currentIndex = 1;
    learnings.forEach((learning) => {
      if (
        learning.source &&
        /^https?:\/\//i.test(learning.source) &&
        !uniqueSourcesMap.has(learning.source)
      ) {
        uniqueSourcesMap.set(learning.source, {
          index: currentIndex++,
          title: learning.title, // Store title from the first occurrence
        });
      }
    });
    const sortedUniqueSources = Array.from(uniqueSourcesMap.keys()).sort();
    // Rebuild map based on sorted order for consistent indexing
    const finalSourceMap = new Map<string, { index: number; title?: string }>();
    sortedUniqueSources.forEach((source, index) => {
      const originalData = uniqueSourcesMap.get(source);
      finalSourceMap.set(source, {
        index: index + 1,
        title: originalData?.title,
      });
    });
    // --- End Source Map Creation ---

    // Format learnings for the prompt using the index map
    const learningsText = learnings
      .map((learning, index) => {
        let sourceInfo = "";
        if (learning.source && finalSourceMap.has(learning.source)) {
          sourceInfo = ` (Source [${
            finalSourceMap.get(learning.source)?.index
          }])`;
        }
        // Original learning index (e.g., [1]) still useful for context
        return `[${index + 1}] ${learning.text}${sourceInfo}`;
      })
      .join("\n\n");

    // Construct the prompt (instructions updated for Source [INDEX])
    const prompt = `You are a **subject matter expert and research analyst** tasked with generating an **in-depth, comprehensive, and critically analyzed** research report.

**Topic:** ${query}

**Based *primarily* on the following research findings (with source index mappings provided):**
${learningsText}

**Instructions:**
1.  **Write a full, detailed research report** including:
    *   A clear and specific **Title** for the report.
    *   An engaging **Introduction** that clearly defines the scope, methodology (based on analyzing provided findings), and previews the key themes and arguments to be developed.
    *   Logically organized **Sections** (aim for 4-6 substantial main sections) that **deeply analyze, synthesize, compare, contrast, and critically evaluate** the provided findings. **Elaborate significantly** on each point, providing context derived from the findings, explaining implications, and drawing connections between different pieces of information. **Do NOT merely summarize or list the findings.** Go beyond the surface level.
    *   A thoughtful **Conclusion** summarizing the core arguments and insights derived from the analysis, addressing the nuances of the main topic, acknowledging limitations based on the provided findings, and suggesting specific, logical future directions or unanswered questions arising from the analysis.
2.  **Cite sources inline** meticulously using the format (Source [INDEX]) *immediately* after the information derived from that source. The INDEX corresponds to the position of the source URL in the automatically generated References section at the end of the report.
3.  **DO NOT generate a separate "References" or "Sources" section at the end.** A reference list will be appended automatically later.
4.  Format the entire report using clear **Markdown**, including appropriate headings (# Title, ## Section Title, ### Subsection Title if necessary for structure).
5.  Ensure the report flows logically with strong transitions between sections and maintains a professional, objective, and analytical tone throughout.
6.  **Depth and Length:** The report MUST be **thorough and detailed**, reflecting a deep engagement with the provided findings. Aim for a minimum word count of **1500 words**, adjusting based on the richness of the findings, but prioritize depth and substantial elaboration over brevity. Shallow summaries are unacceptable.
7.  **Fully Utilize Provided Findings:** You MUST incorporate specific details, nuances, statistics, names, or examples mentioned in the '**Based on the following research findings**' section directly into your analysis within the report body to support your points and demonstrate thorough use of the provided material.
8.  **Critical Analysis:** Where appropriate, evaluate the strength of evidence provided, identify potential biases or limitations in the sources, and consider alternative interpretations or perspectives that might be relevant. You may incorporate general domain knowledge **only when necessary** to provide essential context or comparison, but ensure your core analysis remains grounded in the provided research findings.
9.  **Societal, Ethical, or Future Implications:** Consider the broader implications of the findings, including potential societal impacts, ethical considerations, or future trends that logically follow from the information provided.

**Output the complete Markdown report directly, starting with the # Title.**`;

    console.log("Full Report Prompt:", prompt);

    try {
      // Single LLM call to generate the full report body
      const result = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt,
        // Optional: Consider increasing max_tokens if needed and supported
      });

      // Clean the entire generated report body
      const cleanedReportBody = this.cleanLLMMarkdown(result.text);

      // Generate the separate references section using the final map
      const referencesSection = this.generateReferences(finalSourceMap);

      // Combine cleaned body, references, and timestamp
      const finalReport = `${cleanedReportBody}\n\n${referencesSection}\n\n*Report generated: ${new Date().toISOString()}*`;

      return finalReport;
    } catch (error) {
      console.error("Error generating full report via single call:", error);
      // Regenerate map for emergency report if needed
      const emergencySourceMap = new Map<
        string,
        { index: number; title?: string }
      >();
      let emergencyIndex = 1;
      learnings.forEach((learning) => {
        if (
          learning.source &&
          /^https?:\/\//i.test(learning.source) &&
          !emergencySourceMap.has(learning.source)
        ) {
          emergencySourceMap.set(learning.source, {
            index: emergencyIndex++,
            title: learning.title,
          });
        }
      });
      return this.generateEmergencyReportFromLearnings(
        learnings,
        query,
        emergencySourceMap
      );
    }
  }

  /**
   * Generates references section based on a map of sources to their index and title.
   */
  private generateReferences(
    sourceMap: Map<string, { index: number; title?: string }>
  ): string {
    let referencesSection = "## References\n\n";
    if (sourceMap.size === 0) {
      referencesSection +=
        "No valid source URLs were cited in the provided learnings.\n";
    } else {
      // Sort by index before rendering
      const sortedEntries = Array.from(sourceMap.entries()).sort(
        (a, b) => a[1].index - b[1].index
      );

      sortedEntries.forEach(([url, data]) => {
        // Basic fallback title generation from URL hostname
        let linkText = data.title || "Source"; // Use title if available, fallback to "Source"
        try {
          if (!data.title) {
            const urlObj = new URL(url);
            linkText = urlObj.hostname.replace(/^www\./, ""); // Use hostname as fallback
          }
        } catch (e) {
          /* Ignore URL parsing errors, use "Source" */
        }

        // Truncate link text if excessively long
        const MAX_LINK_TEXT_LENGTH = 80;
        if (linkText.length > MAX_LINK_TEXT_LENGTH) {
          linkText = linkText.substring(0, MAX_LINK_TEXT_LENGTH - 3) + "...";
        }

        referencesSection += `${data.index}. [${linkText}](${url})\n`; // Format as Markdown link
      });
    }
    return referencesSection;
  }

  /**
   * Generates a very simple emergency report when other methods fail.
   */
  private generateEmergencyReportFromLearnings(
    learnings: Learning[],
    query: string,
    sourceMap: Map<string, { index: number; title?: string }>
  ): string {
    // Group learnings by source - RENAME local variable to avoid conflict
    const learningsBySourceGroup: Record<string, Learning[]> = {};

    for (const learning of learnings) {
      const source = learning.source || "Unknown source";
      // Use the RENAMED variable here
      if (!learningsBySourceGroup[source]) {
        learningsBySourceGroup[source] = [];
      }
      learningsBySourceGroup[source].push(learning);
    }

    let report = `# Research Report: ${query}\n\n`;

    // Add a simple summary
    report += `## Summary\n\nThis report presents findings related to "${query}" based on ${learnings.length} research insights.\n\n`;

    // Add key findings grouped by source
    report += `## Key Findings\n\n`;

    // Use the RENAMED variable here
    Object.entries(learningsBySourceGroup).forEach(
      ([source, sourceLearnings]: [string, Learning[]]) => {
        report += `### From ${source}\n\n`;

        // Add explicit types here
        sourceLearnings.forEach((learning: Learning, index: number) => {
          report += `${index + 1}. ${learning.text}\n\n`;
        });
      }
    );

    // Generate references using the provided map (parameter `sourceMap`)
    const references = this.generateReferences(sourceMap);
    report += `\n\n${references}\n`;

    report += `\n*Note: This is a basic report generated due to an error in the standard report generation process.*\n`;
    report += `\n*Report generated: ${new Date().toISOString()}*`;

    return report;
  }
}
