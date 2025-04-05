"use client";

import { useRouter } from "next/navigation";
import { useWindowSize } from "usehooks-ts";

import { ModelSelector } from "@/components/model-selector";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { Button } from "@/components/ui/button";
import { useSidebar } from "./ui/sidebar";
import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { SquarePen } from "lucide-react";
import { useDeepResearch } from "@/lib/deep-research-context";
import { LLMSettings, SettingsCredenza } from "./settings-dialog";

interface ChatHeaderProps {
  selectedModelId: string;
  settings?: LLMSettings;
  onSettingsChange?: (settings: LLMSettings) => void;
}

function PureChatHeader({
  selectedModelId,
  settings = {},
  onSettingsChange = () => {},
}: ChatHeaderProps) {
  const router = useRouter();
  const { open } = useSidebar();

  const { width: windowWidth } = useWindowSize();

  const { clearState } = useDeepResearch();

  return (
    <header className="flex sticky top-0 bg-background items-center md:justify-start justify-between p-2 gap-2">
      {!open && <SidebarToggle variant="outline" size="sm" />}

      {(!open || windowWidth < 768) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="order-2 md:order-1"
              onClick={() => {
                router.push("/");
                router.refresh();
                clearState();
              }}
            >
              <SquarePen className="size-5 md:mr-2" />
              <span className="sr-only md:not-sr-only">New Chat</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="block md:hidden">New Chat</TooltipContent>
        </Tooltip>
      )}

      <ModelSelector
        selectedModelId={selectedModelId}
        className="order-1 md:order-2"
        label="Router Model"
      />

      <div className="ml-auto order-3 md:order-4">
        <SettingsCredenza
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      </div>
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.selectedModelId === nextProps.selectedModelId &&
    JSON.stringify(prevProps.settings) === JSON.stringify(nextProps.settings)
  );
});
