import { motion } from "framer-motion";
import { cn, getFaviconUrl } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import { ResearchLogEntry } from "@/lib/deep-research/types";

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
