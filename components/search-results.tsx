"use client";

import { cn } from "@/lib/utils";
import { ExternalLinkIcon } from "./icons";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import { SearchResultItem } from "@/lib/search/types";
import { LoaderCircle } from "lucide-react";

interface SearchResultsProps {
  results: SearchResultItem[];
  isLoading?: boolean;
  searchTitle?: string;
}

interface EarthIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export function SearchResults({
  results,
  isLoading = false,
  searchTitle,
}: SearchResultsProps) {
  const earthIconRef = useRef<EarthIconHandle>(null);

  useEffect(() => {
    if (isLoading && earthIconRef.current) {
      earthIconRef.current.startAnimation();
    } else if (!isLoading && earthIconRef.current) {
      earthIconRef.current.stopAnimation();
    }
  }, [isLoading]);

  if (!results.length && !isLoading) return null;

  return (
    <div className="w-full">
      <div className="grid gap-2">
        {isLoading ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="flex items-center gap-3 rounded-full bg-gradient-to-r from-orange-100 to-orange-200 px-4 py-2 shadow-md text-sm font-semibold text-orange-700 w-fit"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            >
              <LoaderCircle size={20} className="stroke-orange-600" />
            </motion.div>

            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              {searchTitle || "Searching the web..."}
            </motion.span>
          </motion.div>
        ) : (
          <>
            <div className="flex items-center gap-2 mt-4 mb-2">
              <span className="text-sm font-medium">Sources</span>
            </div>
            {results.map((result, i) => (
              <a
                key={i}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex flex-col w-full px-3 py-2 text-sm",
                  "rounded-lg border bg-background hover:bg-accent transition-colors",
                  "group cursor-pointer"
                )}
              >
                <div className="flex justify-between items-start w-full">
                  <div className="flex flex-col gap-1 grow">
                    <div className="flex items-center gap-2">
                      {result.favicon && (
                        <Image
                          src={result.favicon}
                          alt="Favicon"
                          width={16}
                          height={16}
                          className="size-4 rounded-sm"
                        />
                      )}
                      <span className="font-medium">{result.title}</span>
                    </div>
                    {result.publishedDate && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(result.publishedDate).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          }
                        )}
                      </span>
                    )}
                  </div>
                  <ExternalLinkIcon
                    size={14}
                    className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors mt-1"
                  />
                </div>

                {result.relevantContent && (
                  <div className="mt-2 text-xs text-muted-foreground border-t pt-2 line-clamp-5">
                    <p className="mb-1 text-[11px] uppercase font-medium">
                      Content excerpt:
                    </p>
                    {result.relevantContent}
                  </div>
                )}
              </a>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
