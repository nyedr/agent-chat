"use client";
import { useState, useEffect } from "react";
import { cn, formatFileSize, getFileInfoFromUrl } from "@/lib/utils";
import { Download, Eye, Loader2, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArtifact } from "@/hooks/use-artifact";
import { ArtifactKind } from "@/components/artifact";
import { toast } from "sonner";

interface FilePreviewProps {
  filename: string;
  url: string;
  downloadable?: boolean;
  viewable?: boolean;
}

// Map simplified file types to artifact kinds
const fileTypeToArtifactKind: Record<string, ArtifactKind | null> = {
  text: "text",
  code: "code",
  image: "image",
  spreadsheet: "sheet",
  // pdf, document, video, audio, archive currently not viewable as artifacts
  pdf: null,
  document: null,
  video: null,
  audio: null,
  archive: null,
  presentation: null,
  unknown: null,
};

export function FilePreview({
  filename,
  url,
  downloadable = true,
  viewable = true,
}: FilePreviewProps) {
  const [fetchedFileSize, setFetchedFileSize] = useState<number | null>(null);
  const [isLoadingSize, setIsLoadingSize] = useState<boolean>(true);
  const [errorLoadingSize, setErrorLoadingSize] = useState<string | null>(null);
  const [isViewing, setIsViewing] = useState<boolean>(false);

  const { setArtifact } = useArtifact();

  const {
    actualFilename,
    displayFilename,
    fileType,
    IconComponent,
    colorClass,
  } = getFileInfoFromUrl(url, filename);

  const artifactKind = fileTypeToArtifactKind[fileType];
  const canBeViewed = viewable && artifactKind !== null;

  useEffect(() => {
    if (!url) return;
    let isMounted = true;
    setIsLoadingSize(true);
    setErrorLoadingSize(null);
    setFetchedFileSize(null);

    const fetchSize = async () => {
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) {
          throw new Error(` ${response.status} ${response.statusText}`);
        }
        const sizeHeader = response.headers.get("Content-Length");
        if (sizeHeader) {
          const size = parseInt(sizeHeader, 10);
          if (!isNaN(size) && isMounted) setFetchedFileSize(size);
          else if (isMounted) setErrorLoadingSize("Invalid size header");
        } else {
          if (isMounted) setErrorLoadingSize("Missing size header");
        }
      } catch (error) {
        console.error("Error fetching file size:", error);
        if (isMounted)
          setErrorLoadingSize(
            `Fetch error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
      } finally {
        if (isMounted) setIsLoadingSize(false);
      }
    };
    fetchSize();
    return () => {
      isMounted = false;
    };
  }, [url]);

  const displaySize =
    fetchedFileSize !== null ? formatFileSize(fetchedFileSize) : null;

  const handleViewClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canBeViewed || !artifactKind) return;

    setIsViewing(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      let content: string;
      if (artifactKind === "image") {
        const blob = await response.blob();
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            // Strip the data URL prefix (e.g., "data:image/png;base64,")
            const base64Content = result.substring(result.indexOf(",") + 1);
            resolve(base64Content);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        content = await response.text();
      }

      setArtifact({
        documentId: `preview:${url}`,
        content: content,
        kind: artifactKind,
        title: displayFilename,
        status: "idle",
        isVisible: true,
        boundingBox: {
          top: 0,
          left: 0,
          width: 0,
          height: 0,
        },
      });
    } catch (error) {
      console.error("Error loading file into artifact:", error);
      toast.error(
        `Failed to load file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setIsViewing(false);
    }
  };

  return (
    <div className="not-prose my-2 flex items-center gap-3 p-3 w-full max-w-sm rounded-md shadow-sm transition-colors duration-200 bg-background border border-border">
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-md flex-shrink-0",
          colorClass
        )}
        title={fileType.charAt(0).toUpperCase() + fileType.slice(1)}
      >
        <IconComponent className="size-5" />
      </div>

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          <div
            title={displayFilename}
            className="text-sm font-medium text-foreground truncate"
          >
            {displayFilename}
          </div>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span>
            {fileType
              ? fileType.charAt(0).toUpperCase() + fileType.slice(1)
              : "File"}
          </span>
          {isLoadingSize && (
            <Loader2 className="size-3 animate-spin text-muted-foreground/70" />
          )}
          {displaySize && !isLoadingSize && <span>· {displaySize}</span>}
          {errorLoadingSize && !isLoadingSize && (
            <span
              title={errorLoadingSize}
              className="flex items-center gap-0.5 text-destructive/80"
            >
              · <FileWarning className="size-3" /> N/A
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canBeViewed && (
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-md border-border hover:bg-accent/50 hover:text-accent-foreground disabled:opacity-50"
            onClick={handleViewClick}
            disabled={isViewing}
            title={`View ${displayFilename} (${artifactKind})`}
          >
            {isViewing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Eye className="size-4" />
            )}
            <span className="sr-only">View</span>
          </Button>
        )}

        {downloadable && (
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-md border-border hover:bg-accent/50 hover:text-accent-foreground"
            asChild
          >
            <a
              href={url}
              download={
                actualFilename !== "file" ? actualFilename : displayFilename
              }
              title={`Download ${displayFilename}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="size-4" />
              <span className="sr-only">Download</span>
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
