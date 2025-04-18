import { motion } from "framer-motion";
import {
  calculateProgressPercentage,
  cn,
  formatTime,
  getFaviconUrl,
} from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  FileSearch,
  Bot,
  Wrench,
  ExternalLink,
  type LucideIcon,
  Info,
  Lightbulb,
  DraftingCompass,
  SearchCheck,
  FileText,
  Clock,
  Layers,
  Search,
  Zap,
} from "lucide-react";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./ui/tooltip";
import { ResearchLogEntry } from "@/lib/deep-research/types";
import { Progress } from "./ui/progress";
import { useDeepResearch } from "@/lib/deep-research-context";
import { Badge } from "./ui/badge";

interface Source {
  url: string;
  title: string;
  relevance: number;
}

interface DeepResearchProps {
  isActive: boolean;
  activity?: Array<ResearchLogEntry>;
  sources?: Source[];
}

const LogIcon = ({
  type,
  status,
}: {
  type: ResearchLogEntry["type"];
  status: ResearchLogEntry["status"];
}) => {
  let IconComponent: LucideIcon;

  switch (type) {
    case "plan":
      IconComponent = DraftingCompass;
      break;
    case "search":
      IconComponent = FileSearch;
      break;
    case "scrape":
      IconComponent = ExternalLink;
      break;
    case "vectorize":
      IconComponent = Wrench;
      break;
    case "analyze":
      IconComponent = SearchCheck;
      break;
    case "reasoning":
      IconComponent = Lightbulb;
      break;
    case "synthesis":
      IconComponent = FileText;
      break;
    case "thought":
      IconComponent = Bot;
      break;
    default:
      IconComponent = Info;
      break;
  }

  const colorClass = cn(
    "mt-1",
    status === "complete" && "text-green-500",
    status === "error" && "text-red-500",
    status === "warning" && "text-orange-500"
  );

  const iconSize = "size-4";

  return <IconComponent className={cn(iconSize, colorClass, "shrink-0")} />;
};

const FaviconImage = ({ src, alt }: { src: string; alt: string }) => {
  const [imgSrc, setImgSrc] = useState(src);
  const [hasError, setHasError] = useState(false);

  const handleError = () => {
    if (!hasError) {
      setImgSrc("/favicon.ico");
      setHasError(true);
    }
  };

  return (
    <Image
      src={imgSrc}
      alt={alt}
      width={16}
      height={16}
      className="rounded-full"
      onError={handleError}
    />
  );
};

export function DeepResearch({
  activity = [],
  sources = [],
  isActive,
}: DeepResearchProps) {
  const sourcesByHostname = useMemo(
    () =>
      sources.reduce((acc, source) => {
        const hostname = new URL(source.url).hostname;
        if (!acc[hostname]) {
          acc[hostname] = {
            hostname,
            sources: [source],
            count: 1,
            favicon: getFaviconUrl(source.url),
          };
        } else {
          acc[hostname].sources.push(source);
          acc[hostname].count++;
        }
        return acc;
      }, {} as Record<string, { hostname: string; sources: Source[]; count: number; favicon: string }>),
    [sources]
  );

  if (activity.length === 0 && sources.length === 0) {
    return null;
  }

  return (
    <div className="fixed right-4 top-20 w-80 bg-background border rounded-lg shadow-lg p-4 max-h-[80vh] flex flex-col overflow-y-scroll">
      <Tabs
        defaultValue={isActive ? "activity" : "sources"}
        className="flex flex-col h-full"
      >
        <TabsList className="w-full mb-3">
          <TabsTrigger value="activity" className="flex-1">
            Activity
          </TabsTrigger>
          <TabsTrigger value="sources" className="flex-1">
            Sources
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex-1 overflow-y-auto mt-2">
          <div className="space-y-4 pr-2 h-full">
            {[...activity].map((item, index) => (
              <motion.div
                key={`${item.timestamp}-${index}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3"
              >
                <LogIcon type={item.type} status={item.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground break-words whitespace-pre-wrap">
                    {item.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.depth ? `D${item.depth} | ` : ""}
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </TabsContent>

        <TabsContent
          value="sources"
          className="flex-1 overflow-y-auto mt-2 gap-2"
        >
          <div className="space-y-4 pr-2">
            {sources
              .sort((a, b) => b.relevance - a.relevance)
              .map((source, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-1"
                >
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline break-words"
                  >
                    {source.title}
                  </a>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground truncate">
                      {new URL(source.url).hostname}
                    </div>
                  </div>
                </motion.div>
              ))}
          </div>

          <div className="flex flex-col gap-2 mt-4">
            <span className="text-lg font-medium">All sources</span>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(sourcesByHostname).map(([hostname, source]) => (
                <Link
                  href={`https://${source.hostname}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid grid-cols-[16px_1fr] w-fit text-sm items-center gap-2 border rounded-full py-1 px-2"
                  key={hostname}
                >
                  <FaviconImage src={source.favicon} alt={source.hostname} />
                  {source.hostname}
                </Link>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const MAX_RESEARCH_DURATION = process.env.NEXT_PUBLIC_MAX_RESEARCH_DURATION
  ? parseInt(process.env.NEXT_PUBLIC_MAX_RESEARCH_DURATION)
  : 10;

export const DeepResearchProgress = () => {
  const { state: deepResearchState } = useDeepResearch();

  const progress = useMemo(
    () =>
      calculateProgressPercentage(
        deepResearchState.completedSteps,
        deepResearchState.totalExpectedSteps
      ),
    [deepResearchState.completedSteps, deepResearchState.totalExpectedSteps]
  );

  const [startTime] = useState<number>(Date.now());
  const maxDuration = MAX_RESEARCH_DURATION * 60 * 1000;
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = useMemo(
    () => Math.min(currentTime - startTime, maxDuration),
    [currentTime, startTime, maxDuration]
  );
  const formattedTimeElapsed = formatTime(elapsed);
  const formattedMaxDuration = formatTime(maxDuration);
  const timeProgress = useMemo(
    () => (elapsed / maxDuration) * 100,
    [elapsed, maxDuration]
  );
  const timeRemaining = formatTime(Math.max(0, maxDuration - elapsed));

  const currentActivity =
    deepResearchState.activity.length > 0
      ? deepResearchState.activity[deepResearchState.activity.length - 1]
          .message
      : "Initializing research...";

  const getStatusColor = () => {
    if (progress < 25) return "text-blue-500";
    if (progress < 50) return "text-amber-500";
    if (progress < 75) return "text-orange-500";
    return "text-green-500";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full space-y-4 rounded-xl border p-5 text-card-foreground shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 2,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }}
            className="flex items-center justify-center rounded-full bg-primary/10 p-1.5"
          >
            <Search className="size-4 text-primary" />
          </motion.div>
          <span className="font-semibold text-foreground">
            Research in Progress
          </span>
          <Badge variant="outline" className={`ml-2 ${getStatusColor()}`}>
            {progress < 25
              ? "Starting"
              : progress < 50
              ? "Gathering"
              : progress < 75
              ? "Analyzing"
              : "Finalizing"}
          </Badge>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs font-medium">
                <div className="flex items-center gap-1.5">
                  <Layers className="size-3.5 text-primary" />
                  <span>
                    {deepResearchState.currentDepth}/
                    {deepResearchState.maxDepth}
                  </span>
                </div>
                <div className="h-3 w-px bg-border" />
                <div className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-primary" />
                  <span>
                    {deepResearchState.completedSteps}/
                    {deepResearchState.totalExpectedSteps}
                  </span>
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Current depth and completed steps</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Overall Progress</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <Progress max={100} value={progress} className="h-2.5 w-full" />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5" />
            <span>Time Remaining: {timeRemaining}</span>
          </div>
          <span className="font-medium text-xs">
            {formattedTimeElapsed} / {formattedMaxDuration}
          </span>
        </div>
        <Progress max={100} value={timeProgress} className="h-1.5 w-full" />
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <div className="size-2 animate-pulse rounded-full bg-primary" />
          <span className="text-xs font-medium">Current Activity</span>
        </div>
        <p className="text-sm text-muted-foreground">{currentActivity}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {deepResearchState.activity.slice(-3).map((activity, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="rounded-md border border-border/50 bg-background p-2"
          >
            <span className="line-clamp-2 text-muted-foreground">
              {activity.message.split(" ").slice(0, 5).join(" ")}...
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};
