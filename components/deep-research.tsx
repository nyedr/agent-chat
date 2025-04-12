import { motion } from "framer-motion";
import { cn, getFaviconUrl } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "./ui/button";

interface Source {
  url: string;
  title: string;
  relevance: number;
}

interface DeepResearchProps {
  isActive: boolean;
  activity?: Array<{
    type:
      | "search"
      | "extract"
      | "analyze"
      | "reasoning"
      | "synthesis"
      | "thought";
    status: "pending" | "complete" | "error";
    message: string;
    timestamp: string;
  }>;
  sources?: Source[];
}

export function DeepResearch({
  activity = [],
  sources = [],
  isActive,
}: DeepResearchProps) {
  if (activity.length === 0 && sources.length === 0) {
    return null;
  }

  const sourcesByHostname = sources.reduce((acc, source) => {
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
  }, {} as Record<string, { hostname: string; sources: Source[]; count: number; favicon: string }>);

  return (
    <div className="fixed right-4 top-20 w-80 bg-background border rounded-lg shadow-lg p-4 max-h-[80vh] flex flex-col overflow-y-scroll">
      <Tabs
        defaultValue={isActive ? "activity" : "sources"}
        className="flex flex-col h-full"
      >
        <TabsList className="w-full">
          {isActive && (
            <TabsTrigger value="activity" className="flex-1">
              Activity
            </TabsTrigger>
          )}
          <TabsTrigger value="sources" className="flex-1">
            Sources
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="flex-1 overflow-y-auto mt-2">
          <div className="space-y-4 pr-2 h-full">
            {[...activity].reverse().map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3"
              >
                <div
                  className={cn(
                    "size-2 rounded-full shrink-0",
                    item.status === "pending" && "bg-yellow-500",
                    item.status === "complete" && "bg-green-500",
                    item.status === "error" && "bg-red-500"
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground break-words whitespace-pre-wrap">
                    {item.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
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

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">All sources</span>
            <div className="flex items-center gap-2">
              {Object.values(sourcesByHostname).map(
                ({
                  hostname,
                  count,
                  favicon,
                }: {
                  hostname: string;
                  sources: Source[];
                  count: number;
                  favicon: string;
                }) => (
                  <Link
                    href={hostname}
                    key={hostname}
                    className={buttonVariants({
                      variant: "ghost",
                      className: "flex gap-2 items-center",
                    })}
                  >
                    <Image
                      src={favicon}
                      alt={hostname}
                      width={16}
                      height={16}
                    />
                    <span className="text-sm font-medium">{hostname}</span>
                    <span className="text-xs text-muted-foreground">
                      {count}
                    </span>
                  </Link>
                )
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
