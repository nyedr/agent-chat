import React, { memo } from "react";
import ChatMarkdown from "../markdown";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card";
import { useDeepResearch } from "@/lib/deep-research-context";
import { Button } from "../ui/button";
import Image from "next/image";
import { getFaviconUrl } from "@/lib/utils";
import { DeepResearchToolResult } from "@/lib/deep-research/adapter";
import fastDeepEqual from "fast-deep-equal";

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
    <Card className="my-4 border rounded-3xl bg-background drop-shadow-xl">
      <CardHeader className="pb-3"></CardHeader>
      <CardContent>
        <ChatMarkdown
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
  );
};

export const DeepResearchResult = memo(
  DeepResearchResultComponent,
  (prevProps, nextProps) => {
    return fastDeepEqual(prevProps.data, nextProps.data);
  }
);
