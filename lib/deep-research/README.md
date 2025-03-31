# Deep Research System

A modular, extensible system for conducting in-depth research on topics by searching the web, extracting content, generating insights, and producing comprehensive reports.

## Architecture

The system follows a modular design with the following components:

1. **Search Module** - Finds relevant sources using Firecrawl
2. **Source Curator Module** - Filters and ranks sources by relevance
3. **Content Scraper & Converter Module** - Extracts content from web pages and documents
4. **Context Aggregator Module** - Combines content into a unified context
5. **Insight Generator Module** - Analyzes context to generate insights
6. **Factual Verification Module** - Verifies the accuracy of insights
7. **Report Generator Module** - Produces the final research report

These modules are coordinated by the **Research Orchestrator**, which manages the research workflow.

## Usage Example

```typescript
import { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import FirecrawlApp from "@mendable/firecrawl-js";
import { DataStreamWriter } from "ai";
import { ResearchOrchestrator, WorkflowConfig } from "../deep-research";

// Initialize dependencies
const firecrawlApp = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY,
});

const llmProvider: OpenAICompatibleProvider<string, string, string> = {
  chatModel: (modelId: string) => ({
    // Implement the chat model interface
    provider: "openai",
    model: modelId,
    // Add other required properties based on the ai package requirements
  }),
};

// Create a data stream writer for progress updates
const dataStream = new DataStreamWriter();

// Create the research orchestrator
const researchOrchestrator = new ResearchOrchestrator(
  firecrawlApp,
  llmProvider,
  "gpt-4-turbo", // Model ID
  dataStream // Optional data stream for progress updates
);

// Define research configuration
const config: WorkflowConfig = {
  maxDepth: 3, // Maximum depth of research iterations
  maxTokens: 25000, // Maximum tokens for context
  timeout: 180000, // Timeout in milliseconds (3 minutes)
  concurrencyLimit: 3, // Maximum concurrent operations
};

// Run the research
async function runResearch() {
  try {
    const result = await researchOrchestrator.runDeepResearchWorkflow(
      "Impact of quantum computing on cryptography",
      config
    );

    if (result.success) {
      console.log("Research completed successfully!");
      console.log("Report:", result.report);
    } else {
      console.error("Research failed:", result.error);
      console.log("Partial report:", result.report);
    }

    console.log("Progress:", result.progress);
  } catch (error) {
    console.error("Error running research:", error);
  }
}

// Handle progress updates
dataStream.on("data", (data) => {
  const { type, content } = data;

  switch (type) {
    case "progress-init":
      console.log(`Initialized research with ${content.maxDepth} max depth`);
      break;
    case "depth-delta":
      console.log(`Depth ${content.current}/${content.max}`);
      break;
    case "activity-delta":
      console.log(`[${content.type}] ${content.message}`);
      break;
    case "finish":
      console.log("Research completed");
      break;
  }
});

// Run the research
runResearch();
```

## Using Individual Modules

You can also use each module independently:

```typescript
import {
  SearchModule,
  SourceCuratorModule,
  ContentScraperModule,
  ContextAggregatorModule,
  InsightGeneratorModule,
} from "../deep-research";

// Initialize dependencies as shown above

// Create and use individual modules
const searchModule = new SearchModule(firecrawlApp);
const curatorModule = new SourceCuratorModule();

async function searchAndCurateSources(query: string) {
  // Search for sources
  const searchResults = await searchModule.searchWeb(query);
  console.log(`Found ${searchResults.length} sources`);

  // Curate the sources
  const curatedResults = await curatorModule.curateSources(
    searchResults,
    query
  );
  console.log(`Selected ${curatedResults.length} most relevant sources`);

  return curatedResults;
}
```

## Extending the System

Each module is designed to be extensible and replaceable. You can create custom implementations of any module by following the interfaces defined in the system.

To create a custom module, implement the corresponding interface from the `types.ts` file and use it in place of the standard module.

## Error Handling

The system includes comprehensive error handling at each stage. The Research Orchestrator handles exceptions from individual modules and attempts to produce a useful report even when parts of the research process fail.

## Performance Considerations

- The Context Aggregator module limits context size to respect token limits
- The Content Scraper implements concurrency limits to prevent overwhelming web servers
- Timeouts are implemented at various levels to ensure research completes within a reasonable time
