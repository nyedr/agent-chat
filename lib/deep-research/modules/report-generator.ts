import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { Learning } from "./insight-generator";
import { ReportPlan } from "../types";

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
   * Replaces [INDEX] placeholders in text with [INDEX](URL) markdown links.
   */
  private _replaceSourceIndicesWithLinks(
    text: string,
    indexToUrlMap: Map<number, string>
  ): string {
    // Step 1: Expand comma-separated lists like [1, 2, 3] into [1][2][3]
    let processedText = text.replace(
      /\[([0-9]+(?:\s*,\s*[0-9]+)+)\]/g,
      (_, listString: string) => {
        return listString
          .split(/\s*,\s*/)
          .map((numStr) => `[${numStr.trim()}]`)
          .join("");
      }
    );

    // Step 2: Replace individual [INDEX] with markdown links [INDEX](URL)
    // This now handles originals and the ones created from lists.
    processedText = processedText.replace(
      /\[([0-9]+)\]/g,
      (match, indexStr) => {
        const index = parseInt(indexStr, 10);
        const url = indexToUrlMap.get(index);
        // If URL exists in our map, create the link, otherwise leave the original [INDEX]
        return url ? `[${index}](${url})` : match;
      }
    );

    return processedText;
  }

  /**
   * Generates the final research report using a single LLM call, guided by a plan.
   */
  async generateFinalReport(
    learnings: Learning[],
    query: string,
    plan: ReportPlan | null
  ): Promise<string> {
    const reportTitle = plan?.report_title || `Research Report: ${query}`;
    const outlineSections = plan?.report_outline || [
      { title: "Main Findings", key_question: query },
    ];

    // --- Create Source Map FIRST (Before filtering/processing learnings based on scrape status) ---
    const uniqueSourcesMap = new Map<
      string,
      { index: number; title?: string }
    >();
    let currentIndex = 1;
    learnings.forEach((learning) => {
      // Check if source is a valid URL and not already mapped
      if (
        learning.source &&
        /^https?:\/\//i.test(learning.source) && // Ensure it looks like a URL
        !uniqueSourcesMap.has(learning.source)
      ) {
        uniqueSourcesMap.set(learning.source, {
          index: currentIndex++,
          title: learning.title, // Store title from the first occurrence
        });
      }
    });

    // Sort URLs alphabetically for consistent index assignment (optional but good practice)
    const sortedUniqueSources = Array.from(uniqueSourcesMap.keys()).sort();

    // Create the final map with stable indices and the inverse map for link replacement
    const finalSourceMap = new Map<string, { index: number; title?: string }>();
    const indexToUrlMap = new Map<number, string>(); // Create inverse map
    sortedUniqueSources.forEach((source, index) => {
      const finalIndex = index + 1;
      const originalData = uniqueSourcesMap.get(source)!; // We know it exists
      finalSourceMap.set(source, {
        index: finalIndex,
        title: originalData.title,
      });
      indexToUrlMap.set(finalIndex, source); // Populate inverse map
    });
    // --- End Source Map Creation ---

    console.log(
      `Generating full report for "${reportTitle}" with ${learnings.length} learnings (single call, guided by plan)`
    );
    console.log(
      `Created initial source map with ${finalSourceMap.size} unique URLs.`
    );

    // --- Create Formatted References Context for Prompt ---
    const referencesContextLines = [];
    for (const [url, data] of finalSourceMap.entries()) {
      referencesContextLines.push(
        `[${data.index}] ${url}${data.title ? ` - ${data.title}` : ""}`
      );
    }
    const referencesContext = referencesContextLines.join("\n");
    // --- End Formatted References Context ---

    // --- Create JSON map for prompt reinforcement --- NEW STEP ---
    const validIndicesJson: Record<number, string> = {};
    for (const [index, url] of indexToUrlMap.entries()) {
      // Try to get a short name/title, fallback to URL
      const title = finalSourceMap.get(url)?.title;
      // Create a short, somewhat readable name
      let shortName = title
        ? title
            .split(/\s+|[_-]/)
            .slice(0, 3)
            .join(" ")
        : url.split("/").pop() || url;
      if (shortName.length > 30) shortName = shortName.substring(0, 27) + "...";
      validIndicesJson[index] = shortName;
    }
    const validIndicesJsonString = JSON.stringify(validIndicesJson, null, 2);
    // --- End JSON map creation ---

    // Format learnings for the prompt using the index map
    const learningsText = learnings
      .map((learning, index) => {
        let sourceInfo = "";
        if (learning.source && finalSourceMap.has(learning.source)) {
          sourceInfo = ` (Refers to Source Index [${
            finalSourceMap.get(learning.source)?.index
          }])`; // Clarify this is the reference index
        }
        // Original learning index (e.g., Learning [1]) still useful for context
        return `Learning [${index + 1}]: ${learning.text}${sourceInfo}`; // Prefix with "Learning"
      })
      .join("\n\n");

    // Construct the section guidance for the prompt based on the plan
    const sectionGuidance = outlineSections
      .map(
        (section, index) =>
          `${index + 1}. Section Title: "${
            section.title
          }" (Focus on answering: "${section.key_question}")`
      )
      .join("\n");

    // Construct the prompt (updated to use plan title and section guidance)
    const prompt = `You are a **subject matter expert and research analyst** tasked with generating an **in-depth, comprehensive, and critically analyzed** research report.

**Report Title:** ${reportTitle}

**Available Sources for Citation:**
${referencesContext}

**Based *primarily* on the following research findings (learnings):**
${learningsText}

**Valid source indices and their short names (use *only* the integer keys from this JSON object for citations):**
\`\`\`json
${validIndicesJsonString}
\`\`\`

**Instructions:**
1.  **Write a full, detailed research report** following the structure below:
    *   A clear and specific **Title** (use the provided "${reportTitle}").
    *   An engaging **Introduction** that clearly defines the scope (based on the overall query "${query}" and the planned sections), methodology (based on analyzing provided findings), and previews the key themes and arguments to be developed.
    *   Logically organized **Sections** based on the following planned structure. For each section, **deeply analyze, synthesize, compare, contrast, and critically evaluate** the provided findings relevant to the section's key question. **Elaborate significantly** on each point, providing context derived from the findings, explaining implications, and drawing connections between different pieces of information. **Do NOT merely summarize or list the findings.** Go beyond the surface level.
        Planned Sections:
${sectionGuidance}
    *   A thoughtful **Conclusion** summarizing the core arguments and insights derived from the analysis, addressing the nuances of the main topic, acknowledging limitations based on the provided findings, and suggesting specific, logical future directions or unanswered questions arising from the analysis.
2.  **Cite sources inline** meticulously using the format **\`[INDEX]\`** *immediately* after the information derived from that source. **Crucially: Only use the source indices provided in the 'Available Sources for Citation' section and the 'Valid source indices' JSON object above. Ensure every source index used corresponds *exactly* to an entry in those lists. Do NOT invent or hallucinate source numbers.**
3.  **Format the entire report using clear Markdown.** Utilize formatting features extensively to enhance readability:
    *   Use appropriate headings (# Title, ## Section Title, ### Subsection Title).
    *   Employ bullet points and numbered lists for clarity.
    *   Use **bold text** for emphasis on key terms or conclusions.
    *   Use *italics* for definitions or highlighting specific concepts.
    *   **Crucially: Where appropriate for comparing concepts, data, or features (e.g., comparing PTQ vs. QAT, Symmetric vs. Asymmetric methods), use Markdown tables.**
    *   Use code blocks (\`\`\`language ... \`\`\`) for any code snippets or algorithm descriptions if relevant. **Do NOT place citations inside code blocks.**
4.  Ensure the report flows logically with strong transitions between sections and maintains a professional, objective, and analytical tone throughout.
5.  **Depth and Length:** The report MUST be **thorough and detailed**, reflecting a deep engagement with the provided findings. Aim for a minimum word count of **1500 words**, adjusting based on the richness of the findings, but prioritize depth and substantial elaboration over brevity. Shallow summaries are unacceptable.
6.  **Fully Utilize Provided Findings:** You MUST incorporate specific details, nuances, statistics, names, or examples mentioned in the '**Based primarily on the following research findings (learnings)**' section directly into your analysis within the report body to support your points and demonstrate thorough use of the provided material. Reference the 'Learning [X]' markers if needed for clarity during generation, but do not include them in the final output.
7.  **Critical Analysis:** Where appropriate, evaluate the strength of evidence provided, identify potential biases or limitations in the sources, and consider alternative interpretations or perspectives that might be relevant. You may incorporate general domain knowledge **only when necessary** to provide essential context or comparison, but ensure your core analysis remains grounded in the provided research findings.
8.  **Societal, Ethical, or Future Implications:** Consider the broader implications of the findings, including potential societal impacts, ethical considerations, or future trends that logically follow from the information provided.

**Output the complete Markdown report directly, starting with the # Title. Do NOT add a 'References' section yourself; it will be appended automatically.**`;

    console.log("Full Report Prompt (Guided by Plan, Enhanced):", prompt);

    try {
      // Single LLM call to generate the full report body
      const result = await generateText({
        model: this.llmProvider.chatModel(this.modelId),
        prompt,
      });

      // Clean the entire generated report body
      const cleanedReportBody = this.cleanLLMMarkdown(result.text);

      // --- Replace [INDEX] with (INDEX)[URL] ---
      const reportBodyWithLinks = this._replaceSourceIndicesWithLinks(
        cleanedReportBody,
        indexToUrlMap // Use the inverse map
      );
      // --- End Link Replacement ---

      // --- Audit for Unresolved Citations ---
      const unresolvedCitations = new Set<string>();
      // Use a simpler regex for audit - just find bracketed numbers
      reportBodyWithLinks.replace(/\[([0-9]+)\]/g, (match, indexStr) => {
        // If an index still exists in bracket form AFTER link replacement, it's likely invalid
        if (!indexToUrlMap.has(parseInt(indexStr, 10))) {
          unresolvedCitations.add(match);
        }
        return match; // Doesn't matter what we return here
      });
      if (unresolvedCitations.size > 0) {
        console.warn(
          `[ReportGenerator] Found potentially invalid/unresolved citations in generated report: ${Array.from(
            unresolvedCitations
          ).join(", ")}`
        );
        // Optional: Append a note to the report about unresolved citations?
      }
      // --- End Audit Step ---

      // --- Generate References based on USED citations ---
      const usedIndices = new Set<number>();
      // Regex to find indices that were successfully linked: [INDEX](...)
      const linkRegex = /\[([0-9]+)\]\(/g;
      let regexMatch;
      while ((regexMatch = linkRegex.exec(reportBodyWithLinks)) !== null) {
        usedIndices.add(parseInt(regexMatch[1], 10));
      }

      let referencesSection = "";
      if (usedIndices.size > 0) {
        const sortedUsedIndices = Array.from(usedIndices).sort((a, b) => a - b);
        const referenceItems = sortedUsedIndices
          .map((index, i) => {
            const url = indexToUrlMap.get(index);
            if (!url) return null; // Should not happen if audit passes, but safety check
            const title = finalSourceMap.get(url)?.title?.trim() || url;
            return `${i + 1}. [[${index}] ${title}](${url})`;
          })
          .filter((item) => item !== null);
        referencesSection = `## References\n\n${referenceItems.join("\n")}`;
      } else {
        console.warn(
          "[ReportGenerator] No valid citations found in the final report body to generate references."
        );
      }
      // --- End Dynamic References ---

      // Combine body with links, dynamic references, and timestamp
      const finalReport = `${reportBodyWithLinks}\n\n${referencesSection}\n\n*Report generated: ${new Date().toISOString()}*`;

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
        emergencySourceMap,
        plan
      );
    }
  }

  /**
   * Generates the separate references section (No longer directly used by generateFinalReport).
   * Kept for potential utility or direct use elsewhere.
   */
  private generateReferences(
    sourceMap: Map<string, { index: number; title?: string }>
  ): string {
    if (sourceMap.size === 0) {
      return ""; // No sources to list
    }

    const references = Array.from(sourceMap.entries())
      // Sort by index number
      .sort(([, a], [, b]) => a.index - b.index)
      // Format each reference
      .map(([url, data]) => {
        // Use URL as title if title is missing or empty
        const displayTitle = data.title?.trim() ? data.title.trim() : url;
        return `[${data.index}] [${displayTitle}](${url})`; // Format: [INDEX] Title - URL
      });

    return `## References\n\n${references.join("\n")}`;
  }

  /**
   * Generates a very simple emergency report when other methods fail.
   */
  private generateEmergencyReportFromLearnings(
    learnings: Learning[],
    query: string,
    sourceMap: Map<string, { index: number; title?: string }>,
    plan?: ReportPlan | null
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
    const references = this.generateReferences(sourceMap); // Use the separate function
    report += `\n\n${references}\n`;

    report += `\n*Note: This is a basic report generated due to an error in the standard report generation process.*\n`;
    report += `\n*Report generated: ${new Date().toISOString()}*`;

    return report;
  }
}
