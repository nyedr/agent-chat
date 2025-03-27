// Define model types and re-export from the API hook

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Constants for storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  MODALITY_FILTER: "model-modality-filter",
  CONTEXT_FILTER: "model-context-filter",
  SORT_BY: "model-sort-by",
};

export interface ChatModel {
  id: string;
  name: string;
  description: string;
  created: number;
  context_length: number;
  architecture: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
  per_request_limits: any | null;
}

// Add a type for the model display in the selector
export interface ModelDisplay {
  id: string;
  label: string;
  description: string;
  modality: string;
  contextLength: number;
  maxOutputTokens: number | null;
  pricing: {
    prompt: string;
    completion: string;
  };
  isModerated: boolean;
  tokenizer: string;
}

export interface ModelsApiResponse {
  models: ChatModel[];
}

// Note: DEFAULT_MODEL_NAME is now dynamically determined in the useModels hook
// but we'll keep a fallback here for type safety
export const DEFAULT_MODEL_NAME = process.env.NEXT_PUBLIC_DEFAULT_MODEL!;
export const DEFAULT_REASONING_MODEL_NAME =
  process.env.NEXT_PUBLIC_DEFAULT_REASONING_MODEL!;

/**
 * Creates a provider instance
 */
function createProvider() {
  // Get API key and base URL from environment variables
  const provider = process.env.NEXT_PUBLIC_CHAT_PROVIDER;
  const apiKey = process.env.NEXT_PUBLIC_CHAT_API_KEY;
  const baseUrl = process.env.NEXT_PUBLIC_CHAT_BASE_URL;

  if (!apiKey) {
    throw new Error("API key not found");
  }

  if (!baseUrl) {
    throw new Error("Base URL not found");
  }

  return createOpenAICompatible({
    name: provider ?? "openai compatible",
    apiKey,
    baseURL: baseUrl,
  });
}

export const myProvider = createProvider();

// Fetch models function for server-side use
export async function fetchModels(): Promise<ModelsApiResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_CHAT_BASE_URL}/models`,
    {
      headers: {
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_CHAT_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Error fetching models");
  }

  return response.json();
}

// Transform models for display
export function transformModels(models: ChatModel[]): ModelDisplay[] {
  return models.map((model) => ({
    id: model.id,
    label: model.name,
    description: model.description,
    modality: model.architecture.modality,
    contextLength: model.context_length,
    maxOutputTokens: model.top_provider.max_completion_tokens,
    pricing: {
      prompt: model.pricing.prompt,
      completion: model.pricing.completion,
    },
    isModerated: model.top_provider.is_moderated,
    tokenizer: model.architecture.tokenizer,
  }));
}

// Model selector utility types
export type ModelSortOption = "provider" | "context" | "price";
export type ModalityFilterOption = "all" | "text" | "text+image";
export type ContextSizeFilterOption = "all" | "small" | "medium" | "large";

// Available filter options
export const MODALITY_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "text", label: "Text Only" },
  { value: "text+image", label: "Vision" },
];

export const CONTEXT_SIZE_OPTIONS = [
  { value: "all", label: "Any Size" },
  { value: "small", label: "< 32K" },
  { value: "medium", label: "32K - 128K" },
  { value: "large", label: "≥ 128K" },
];

// Type definition for model groups
export type ModelGroup = {
  provider: string;
  models: ModelDisplay[];
};

/**
 * Helper function to format pricing to display pricing per 1M tokens
 */
export const formatPrice = (price: string): string => {
  // Handle special cases for pricing
  if (price === "-1") return "Variable";
  if (price === "0") return "Free";

  const priceNum = parseFloat(price);

  // If price can't be parsed to a number or is invalid
  if (isNaN(priceNum)) return "N/A";

  // If the price is effectively free (very small number)
  if (priceNum < 0.000000000001) return "Free";

  const pricePer1M = priceNum * 1000000;
  return `$${pricePer1M.toFixed(2)}`;
};

/**
 * Helper function to format context length with K/M suffix
 */
export const formatContextLength = (length: number | null): string => {
  // Handle null or undefined case
  if (length === null || length === undefined) return "Unknown";

  // Handle edge cases
  if (length <= 0) return "Variable";

  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  } else if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return length.toString();
};

/**
 * Function to organize models into groups by provider
 */
export function organizeModels(models: ModelDisplay[]): {
  grouped: Record<string, ModelGroup>;
  ungrouped: ModelDisplay[];
} {
  const grouped: Record<string, ModelGroup> = {};
  const ungrouped: ModelDisplay[] = [];

  models.forEach((model: ModelDisplay) => {
    if (model.id.includes("/")) {
      // For models with provider format (e.g., "openai/gpt-4")
      const [provider] = model.id.split("/");
      if (!grouped[provider]) {
        grouped[provider] = {
          provider,
          models: [],
        };
      }
      grouped[provider].models.push(model);
    } else {
      // For models without provider format
      ungrouped.push(model);
    }
  });

  return { grouped, ungrouped };
}

/**
 * Function to filter and sort models based on search and filter criteria
 */
export function filterAndSortModels(
  models: ModelDisplay[],
  search: string,
  modalityFilter: ModalityFilterOption,
  contextSizeFilter: ContextSizeFilterOption,
  sortBy: ModelSortOption
): { grouped: Record<string, ModelGroup>; ungrouped: ModelDisplay[] } {
  // Start with all models
  let filteredModels = [...models];

  // Apply search filter
  if (search) {
    const searchLower = search.toLowerCase();

    // First, filter models that match any criteria
    filteredModels = filteredModels.filter(
      (model) =>
        model.label.toLowerCase().includes(searchLower) ||
        model.id.toLowerCase().includes(searchLower) ||
        model.description.toLowerCase().includes(searchLower)
    );

    // Then, sort the results by search relevance
    filteredModels.sort((a, b) => {
      const aLabelLower = a.label.toLowerCase();
      const bLabelLower = b.label.toLowerCase();

      // Exact label match gets highest priority
      if (aLabelLower === searchLower && bLabelLower !== searchLower) return -1;
      if (bLabelLower === searchLower && aLabelLower !== searchLower) return 1;

      // Next, prioritize labels that start with the search term
      const aLabelStartsWith = aLabelLower.startsWith(searchLower);
      const bLabelStartsWith = bLabelLower.startsWith(searchLower);
      if (aLabelStartsWith && !bLabelStartsWith) return -1;
      if (bLabelStartsWith && !aLabelStartsWith) return 1;

      // Then prioritize any label match
      const aLabelMatch = aLabelLower.includes(searchLower);
      const bLabelMatch = bLabelLower.includes(searchLower);
      if (aLabelMatch && !bLabelMatch) return -1;
      if (bLabelMatch && !aLabelMatch) return 1;

      // Then prioritize ID matches
      const aIdLower = a.id.toLowerCase();
      const bIdLower = b.id.toLowerCase();
      const aIdStartsWith = aIdLower.startsWith(searchLower);
      const bIdStartsWith = bIdLower.startsWith(searchLower);

      // ID starts with search term
      if (aIdStartsWith && !bIdStartsWith) return -1;
      if (bIdStartsWith && !aIdStartsWith) return 1;

      // ID contains search term
      const aIdMatch = aIdLower.includes(searchLower);
      const bIdMatch = bIdLower.includes(searchLower);
      if (aIdMatch && !bIdMatch) return -1;
      if (bIdMatch && !aIdMatch) return 1;

      // Description matches come last in priority
      return 0;
    });
  }

  // Apply modality filter
  if (modalityFilter !== "all") {
    filteredModels = filteredModels.filter((model) =>
      model.modality.toLowerCase().includes(modalityFilter.toLowerCase())
    );
  }

  // Apply context size filter
  if (contextSizeFilter !== "all") {
    switch (contextSizeFilter) {
      case "small":
        filteredModels = filteredModels.filter(
          (model) => model.contextLength > 0 && model.contextLength < 32000
        );
        break;
      case "medium":
        filteredModels = filteredModels.filter(
          (model) =>
            model.contextLength >= 32000 && model.contextLength < 128000
        );
        break;
      case "large":
        filteredModels = filteredModels.filter(
          (model) => model.contextLength >= 128000
        );
        break;
    }
  }

  // Sort models
  if (sortBy === "context") {
    // Sort by context size (largest first), handling edge cases like null values
    filteredModels.sort((a, b) => {
      // Handle null/zero/negative values (Variable context)
      if (a.contextLength <= 0 && b.contextLength <= 0) return 0;
      if (a.contextLength <= 0) return 1; // Put variable context at the end
      if (b.contextLength <= 0) return -1;

      return b.contextLength - a.contextLength;
    });
  } else if (sortBy === "price") {
    // Sort by price (cheapest first), handling edge cases
    filteredModels.sort((a, b) => {
      const priceA = a.pricing.completion;
      const priceB = b.pricing.completion;

      // Handle special price values
      if (priceA === "-1" && priceB === "-1") return 0;
      if (priceA === "-1") return 1; // Put variable price at the end
      if (priceB === "-1") return -1;

      // Handle free models
      if (priceA === "0" && priceB === "0") return 0;
      if (priceA === "0") return -1; // Free models first
      if (priceB === "0") return 1;

      // Normal price comparison
      return parseFloat(priceA) - parseFloat(priceB);
    });
  }

  // Organize filtered models
  return organizeModels(filteredModels);
}
