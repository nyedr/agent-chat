import React, { HTMLProps, memo } from "react";
import ChatMarkdown from "../markdown";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { useDeepResearch } from "@/lib/deep-research-context";
import { Button } from "../ui/button";
import Image from "next/image";
import { cn, getFaviconUrl } from "@/lib/utils";
import { DeepResearchToolResult } from "@/lib/deep-research/adapter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DeepResearchResultProps {
  data: DeepResearchToolResult["data"];
}

const formatDuration = (ms: number) => {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0 && seconds === 0) return "<1s";
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const DeepResearchResultComponent: React.FC<DeepResearchResultProps> = ({
  data,
}) => {
  const { setIsResearchInfoOpen, setStateFromResult } = useDeepResearch();

  if (!data) {
    return (
      <div className="text-red-500">
        Error: Missing deep research result data.
      </div>
    );
  }

  // Provide defaults for potentially missing data
  const { reportContent, metrics, sources } = data;
  const timeElapsedFormatted = formatDuration(metrics?.timeElapsed || 0);
  const sourcesExamined = metrics?.sourcesExamined || 0;

  const maxAvatarsWithIcons = 5;
  const sourceLinks = Object.keys(sources || {});

  const avatarFaviconUrls = Array.from({ length: sourcesExamined }, (_, i) => {
    return getFaviconUrl(sourceLinks[i]);
  });

  const avatarFavicons = [...new Set(avatarFaviconUrls)].slice(
    0,
    maxAvatarsWithIcons
  );

  return (
    <TooltipProvider delayDuration={100}>
      <Card className="my-4 border rounded-3xl bg-background drop-shadow-xl">
        <CardHeader className="pb-3"></CardHeader>
        <CardContent>
          <ChatMarkdown
            components={{
              a: ({
                href,
                children,
                className,
                ...props
              }: HTMLProps<HTMLAnchorElement>) => {
                const isCitationLink =
                  href &&
                  sources &&
                  sources[href] &&
                  typeof children === "string" &&
                  !isNaN(parseInt(children));

                if (isCitationLink) {
                  const sourceTitle = sources[href];
                  let hostname = href;
                  try {
                    hostname = new URL(href).hostname;
                  } catch (e) {
                    console.warn(
                      `Invalid URL for hostname extraction: ${href}`
                    );
                  }

                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "text-primary hover:underline",
                            className
                          )}
                          {...props}
                        >
                          [{children}]
                        </a>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs break-words bg-background text-foreground border shadow-lg p-3 rounded-md">
                        <div className="flex items-center gap-2 mb-1">
                          <Image
                            src={getFaviconUrl(href)}
                            alt={hostname}
                            className="size-4 rounded-full shrink-0"
                            width={16}
                            height={16}
                            unoptimized
                          />
                          <p className="text-xs font-medium truncate">
                            {hostname}
                          </p>
                        </div>
                        <p className="text-sm font-semibold mb-1">
                          {sourceTitle || "Title not available"}
                        </p>
                        <p className="text-xs text-muted-foreground">{href}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("text-primary hover:underline", className)}
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
            }}
            content={reportContent || "Report content not available."}
          />
        </CardContent>
        <CardFooter className="flex flex-col gap-2 items-start">
          <Button
            variant="outline"
            onClick={() => {
              setStateFromResult(data);
              setIsResearchInfoOpen(true);
            }}
            className="gap-0 rounded-3xl"
          >
            {avatarFavicons.map((url, index) => (
              <Image
                key={index}
                src={url}
                alt="Favicon"
                className="size-4 rounded-full"
                width={16}
                height={16}
                unoptimized
              />
            ))}
            <span className="text-muted-foreground py-2 ml-2">
              {sourcesExamined} sources
            </span>
          </Button>
          <span className="text-muted-foreground mt-4">
            Completed in {timeElapsedFormatted} • {sourcesExamined} sources
          </span>
        </CardFooter>
      </Card>
    </TooltipProvider>
  );
};

// should not re-render at all
export const DeepResearchResult = memo(DeepResearchResultComponent, () => {
  return true;
});
