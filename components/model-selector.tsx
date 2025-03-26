"use client";

import {
  startTransition,
  useMemo,
  useOptimistic,
  useState,
  useEffect,
} from "react";
import { Command } from "cmdk";
import { Image, ShieldMinus } from "lucide-react";
import { useWindowSize } from "usehooks-ts";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useModels } from "@/hooks/use-models";
import {
  formatContextLength,
  formatPrice,
  filterAndSortModels,
  MODALITY_OPTIONS,
  CONTEXT_SIZE_OPTIONS,
  STORAGE_KEYS,
  type ModelSortOption,
  type ModalityFilterOption,
  type ContextSizeFilterOption,
  ModelDisplay,
} from "@/lib/ai/models";

import { CheckCircleFillIcon, ChevronDownIcon, SearchIcon } from "./icons";
import { saveModelId } from "@/app/(chat)/actions";
import { cn } from "@/lib/utils";

interface ModelListItemProps {
  model: ModelDisplay;
  isSelected: boolean;
  onSelect: () => void;
}

function ModelListItem({ model, isSelected, onSelect }: ModelListItemProps) {
  // Extract modality type (text, text+image, etc.)
  const modalityType = model.modality.split("->")[0];
  const hasVision = modalityType.includes("image");

  return (
    <Command.Item
      key={model.id}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-sm px-2 py-2 text-sm hover:bg-accent",
        {
          "bg-background": isSelected,
        }
      )}
      data-selected={isSelected}
    >
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{model.label}</span>
          {hasVision && <Image className="size-3.5 text-blue-500" />}
          {model.isModerated && (
            <ShieldMinus className="size-3.5 text-green-500" />
          )}
        </div>
        {isSelected && <CheckCircleFillIcon className="size-4" />}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="font-semibold">Context:</span>
          <span>{formatContextLength(model.contextLength)}</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="font-semibold">Input:</span>
          <span>{formatPrice(model.pricing.prompt)}</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="font-semibold">Output:</span>
          <span>{formatPrice(model.pricing.completion)}</span>
        </div>
      </div>
    </Command.Item>
  );
}

export function ModelSelector({
  selectedModelId,
  className,
  label,
}: {
  selectedModelId: string;
  label: string;
} & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [optimisticModelId, setOptimisticModelId] =
    useOptimistic(selectedModelId);
  const { width } = useWindowSize();

  // Determine alignment based on screen size
  const dropdownAlign = width < 768 ? "center" : "start";

  // Filter states with default values that will be updated from localStorage
  const [modalityFilter, setModalityFilter] =
    useState<ModalityFilterOption>("all");
  const [contextSizeFilter, setContextSizeFilter] =
    useState<ContextSizeFilterOption>("all");
  const [sortBy, setSortBy] = useState<ModelSortOption>("provider"); // provider, context, price

  // Load filter settings from localStorage when component mounts
  useEffect(() => {
    // Only run in client-side environment
    if (typeof window !== "undefined") {
      const savedModalityFilter = localStorage.getItem(
        STORAGE_KEYS.MODALITY_FILTER
      );
      const savedContextFilter = localStorage.getItem(
        STORAGE_KEYS.CONTEXT_FILTER
      );
      const savedSortBy = localStorage.getItem(STORAGE_KEYS.SORT_BY);

      if (savedModalityFilter)
        setModalityFilter(savedModalityFilter as ModalityFilterOption);
      if (savedContextFilter)
        setContextSizeFilter(savedContextFilter as ContextSizeFilterOption);
      if (savedSortBy) setSortBy(savedSortBy as ModelSortOption);
    }
  }, []);

  // Save filter settings to localStorage when they change
  const updateModalityFilter = (value: ModalityFilterOption) => {
    setModalityFilter(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.MODALITY_FILTER, value);
    }
  };

  const updateContextFilter = (value: ContextSizeFilterOption) => {
    setContextSizeFilter(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.CONTEXT_FILTER, value);
    }
  };

  const updateSortBy = (value: ModelSortOption) => {
    setSortBy(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.SORT_BY, value);
    }
  };

  const { models, isLoading, error } = useModels();

  // Apply all filters and sorting to models using the utility function
  const result = useMemo(() => {
    return filterAndSortModels(
      models,
      search,
      modalityFilter,
      contextSizeFilter,
      sortBy
    );
  }, [models, search, modalityFilter, contextSizeFilter, sortBy]);

  // Destructure the result properly with correct property names
  const { grouped: filteredGrouped, ungrouped: filteredUngrouped } = result;

  // Find the selected model for display
  const selectedModel = useMemo(
    () => models.find((model: ModelDisplay) => model.id === optimisticModelId),
    [models, optimisticModelId]
  );

  // If loading, show a loading state
  if (isLoading) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        Loading models...
      </Button>
    );
  }

  // If there's an error and no models are available, show an error state
  if (error && models.length === 0) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        Error loading models
      </Button>
    );
  }

  // If no models are available, show a disabled state
  if (!models.length) {
    return (
      <Button variant="outline" className="md:px-2 md:h-[34px]" disabled>
        No models available
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("justify-between", className)}
          >
            <div className="flex items-center gap-1.5">
              {/* Display selected model information */}
              {selectedModel ? (
                <span className="truncate max-w-[200px]">
                  {selectedModel.label}
                </span>
              ) : (
                <span>Select a {label}</span>
              )}
            </div>
            <ChevronDownIcon className="opacity-50 size-3 ml-1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={dropdownAlign as "center" | "start" | "end"}
          className="w-[345px] p-0"
        >
          <Command>
            <div className="border-b p-2 px-3">
              <div className="w-full flex items-center">
                <SearchIcon className="opacity-60 size-4 mr-2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="bg-transparent flex-1 outline-none text-sm border-none focus:ring-0 focus:outline-none p-2"
                />
              </div>

              {/* Filter toggles in a separate row */}
              <div className="flex items-center gap-1 mt-2">
                {/* Modality filter */}
                <Select
                  value={modalityFilter}
                  onValueChange={(value) =>
                    updateModalityFilter(value as ModalityFilterOption)
                  }
                >
                  <SelectTrigger className="h-8 text-xs border-none">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Context size filter */}
                <Select
                  value={contextSizeFilter}
                  onValueChange={(value) =>
                    updateContextFilter(value as ContextSizeFilterOption)
                  }
                >
                  <SelectTrigger className="h-8 text-xs border-none">
                    <SelectValue placeholder="Size" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTEXT_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Sort by selector */}
                <Select
                  value={sortBy}
                  onValueChange={(value) =>
                    updateSortBy(value as ModelSortOption)
                  }
                >
                  <SelectTrigger className="h-8 text-xs border-none">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="provider">Provider</SelectItem>
                    <SelectItem value="context">Context Size</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ScrollArea className="h-[400px]">
              <Command.List className="p-2">
                {/* Show organized provider groups */}
                {Object.values(filteredGrouped).map((group) => (
                  <div key={group.provider} className="mb-3">
                    <h3 className="text-[11px] uppercase font-medium opacity-70 ml-2 mb-1">
                      {group.provider}
                    </h3>
                    {group.models.map((model) => (
                      <ModelListItem
                        key={model.id}
                        model={model}
                        isSelected={model.id === optimisticModelId}
                        onSelect={async () => {
                          setOpen(false);
                          setOptimisticModelId(model.id);
                          startTransition(() => {
                            saveModelId(model.id);
                          });
                        }}
                      />
                    ))}
                  </div>
                ))}

                {/* Show ungrouped models if any */}
                {filteredUngrouped.length > 0 && (
                  <div>
                    {Object.values(filteredGrouped).length > 0 && (
                      <h3 className="text-[11px] uppercase font-medium opacity-70 ml-2 mb-1">
                        Other
                      </h3>
                    )}
                    {filteredUngrouped.map((model) => (
                      <ModelListItem
                        key={model.id}
                        model={model}
                        isSelected={model.id === optimisticModelId}
                        onSelect={async () => {
                          setOpen(false);
                          setOptimisticModelId(model.id);
                          startTransition(() => {
                            saveModelId(model.id);
                          });
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Show empty state if no results */}
                {Object.values(filteredGrouped).length === 0 &&
                  filteredUngrouped.length === 0 && (
                    <div className="text-sm py-6 text-center text-muted-foreground">
                      No models match your criteria
                    </div>
                  )}
              </Command.List>
            </ScrollArea>
          </Command>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
