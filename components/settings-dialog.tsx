"use client";

import { useState, useEffect } from "react";
import { Info, Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";

export interface LLMSettings {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
}

// Default values for LLM settings
const DEFAULT_SETTINGS: Required<LLMSettings> = {
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 2048,
  topK: 50,
  presencePenalty: 0,
  frequencyPenalty: 0,
  seed: undefined as unknown as number,
};

interface SettingsDialogProps {
  settings: LLMSettings;
  onSettingsChange: (settings: LLMSettings) => void;
}

export function SettingsDialog({
  settings,
  onSettingsChange,
}: SettingsDialogProps) {
  // Initialize local settings with merged defaults and current settings
  const [localSettings, setLocalSettings] = useState<LLMSettings>({
    ...DEFAULT_SETTINGS,
    ...settings,
  });
  const [open, setOpen] = useState(false);

  // Update local settings when parent settings change
  useEffect(() => {
    setLocalSettings({
      ...DEFAULT_SETTINGS,
      ...settings,
    });
  }, [settings]);

  const handleSliderChange = (key: keyof LLMSettings, values: number[]) => {
    setLocalSettings({
      ...localSettings,
      [key]: values[0],
    });
  };

  const handleInputChange = (key: keyof LLMSettings, value: string) => {
    const numValue = key === "seed" ? parseInt(value) : parseFloat(value);
    setLocalSettings({
      ...localSettings,
      [key]: isNaN(numValue) ? undefined : numValue,
    });
  };

  const handleSave = () => {
    // Filter out settings that match defaults
    const filteredSettings = Object.entries(localSettings).reduce(
      (acc, [key, value]) => {
        const defaultValue = DEFAULT_SETTINGS[key as keyof LLMSettings];
        if (value !== defaultValue) {
          acc[key as keyof LLMSettings] = value;
        }
        return acc;
      },
      {} as LLMSettings
    );

    onSettingsChange(filteredSettings);
    setOpen(false);
  };

  const handleReset = () => {
    setLocalSettings({});
    onSettingsChange({});
  };

  // Helper to get value with default
  const getValue = (key: keyof LLMSettings) =>
    localSettings[key] !== undefined
      ? localSettings[key]
      : DEFAULT_SETTINGS[key];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="size-5 md:mr-2" />
              <span className="sr-only md:not-sr-only">Settings</span>
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent className="block md:hidden">Settings</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center text-xl">
            <Settings className="mr-2 size-5" />
            Model Settings
          </DialogTitle>
          <DialogDescription>
            Fine-tune language model parameters to customize generation
            behavior.
          </DialogDescription>
        </DialogHeader>
        <Separator className="my-2" />
        <div className="grid gap-6 py-4">
          {/* Temperature */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="temperature">Temperature</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[200px]">
                    Controls randomness. Lower values are more deterministic,
                    higher values more creative.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="temperature-input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                className="w-16 h-8"
                value={getValue("temperature")}
                onChange={(e) =>
                  handleInputChange("temperature", e.target.value)
                }
              />
            </div>
            <Slider
              id="temperature"
              min={0}
              max={2}
              step={0.1}
              value={[getValue("temperature") as number]}
              onValueChange={(values) =>
                handleSliderChange("temperature", values)
              }
              className="pt-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Precise</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Top P */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="topP">Top P</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[200px]">
                    Controls diversity via nucleus sampling. Lower values are
                    more focused, higher values more diverse.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="topP-input"
                type="number"
                step="0.05"
                min="0"
                max="1"
                className="w-16 h-8"
                value={getValue("topP")}
                onChange={(e) => handleInputChange("topP", e.target.value)}
              />
            </div>
            <Slider
              id="topP"
              min={0}
              max={1}
              step={0.05}
              value={[getValue("topP") as number]}
              onValueChange={(values) => handleSliderChange("topP", values)}
              className="pt-2"
            />
          </div>

          {/* Max Tokens */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[200px]">
                    Maximum length of the generated text. Higher values allow
                    longer responses.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="maxTokens-input"
                type="number"
                min="100"
                step="100"
                max="8000"
                className="w-20 h-8"
                value={getValue("maxTokens")}
                onChange={(e) => handleInputChange("maxTokens", e.target.value)}
              />
            </div>
            <Slider
              id="maxTokens"
              min={100}
              max={8000}
              step={100}
              value={[getValue("maxTokens") as number]}
              onValueChange={(values) =>
                handleSliderChange("maxTokens", values)
              }
              className="pt-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Short</span>
              <span>Medium</span>
              <span>Long</span>
            </div>
          </div>

          {/* Advanced Section */}
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-medium">Advanced Settings</h3>
            <Separator />

            {/* Advanced controls in a grid */}
            <div className="grid grid-cols-2 gap-4">
              {/* Presence Penalty */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="presencePenalty" className="text-sm">
                    Presence Penalty
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[180px]">
                      Reduces repetition of topics that have already appeared in
                      the text.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-2 items-center">
                  <Slider
                    id="presencePenalty"
                    min={0}
                    max={2}
                    step={0.1}
                    value={[getValue("presencePenalty") as number]}
                    onValueChange={(values) =>
                      handleSliderChange("presencePenalty", values)
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    className="w-16 h-8"
                    value={getValue("presencePenalty")}
                    onChange={(e) =>
                      handleInputChange("presencePenalty", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Frequency Penalty */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="frequencyPenalty" className="text-sm">
                    Frequency Penalty
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[180px]">
                      Reduces repetition of specific phrases or words.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-2 items-center">
                  <Slider
                    id="frequencyPenalty"
                    min={0}
                    max={2}
                    step={0.1}
                    value={[getValue("frequencyPenalty") as number]}
                    onValueChange={(values) =>
                      handleSliderChange("frequencyPenalty", values)
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    className="w-16 h-8"
                    value={getValue("frequencyPenalty")}
                    onChange={(e) =>
                      handleInputChange("frequencyPenalty", e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Top K */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="topK" className="text-sm">
                    Top K
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[180px]">
                      Limits token selection to the top K most likely tokens.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="topK"
                  type="number"
                  className="h-8"
                  placeholder="50"
                  value={getValue("topK") === undefined ? "" : getValue("topK")}
                  onChange={(e) => handleInputChange("topK", e.target.value)}
                />
              </div>

              {/* Seed */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="seed" className="text-sm">
                    Seed
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[180px]">
                      For deterministic generation. Same seed produces same
                      output (when temperature=0).
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="seed"
                  type="number"
                  className="h-8"
                  placeholder="Optional"
                  value={getValue("seed") === undefined ? "" : getValue("seed")}
                  onChange={(e) => handleInputChange("seed", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button type="submit" onClick={handleSave}>
            Apply Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
