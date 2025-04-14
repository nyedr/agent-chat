import { Artifact, ArtifactContent } from "@/components/create-artifact";
import { CodeEditor, EditorProps } from "@/components/code-editor";
import { CopyIcon, MessageIcon, RedoIcon, UndoIcon } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import React, { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  Eye,
  ExternalLink,
  Code,
  CheckCircle,
  Copy,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Metadata {
  viewMode: "code" | "preview";
}

type HtmlArtifactDisplayProps = Omit<
  ArtifactContent<Metadata>,
  "getDocumentContentById" | "title" | "isInline"
> &
  Omit<EditorProps, "content">;

export const HtmlArtifactDisplay: React.FC<HtmlArtifactDisplayProps> = ({
  content,
  metadata,
  setMetadata,
  isLoading,
  onSaveContent,
  status,
  isCurrentVersion = true,
  currentVersionIndex = 0,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [localViewMode, setLocalViewMode] = useState<"code" | "preview">(
    metadata?.viewMode || "preview"
  );

  console.log(
    "[HtmlArtifactDisplay] Rendering. Initial localViewMode:",
    localViewMode,
    "Metadata prop:",
    metadata
  );

  const copyToClipboard = () => {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const refreshPreview = () => {
    setPreviewKey((prev) => prev + 1);
  };

  const openInNewTab = () => {
    const blob = new Blob([content], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="w-full h-[400px]" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col border rounded-md shadow-sm bg-card font-['Noto_Sans'] h-full"
      )}
    >
      <Tabs
        value={localViewMode}
        onValueChange={(value) => {
          const newMode = value as "code" | "preview";
          console.log("[HtmlArtifactDisplay] Tab changed to value:", newMode);
          setLocalViewMode(newMode);
          console.log("[HtmlArtifactDisplay] Calling setMetadata prop with:", {
            viewMode: newMode,
          });
          setMetadata((prev) => ({
            ...prev,
            viewMode: newMode,
          }));
        }}
        className="size-full flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <TabsList className="h-9">
              <TabsTrigger
                value="preview"
                className="flex items-center gap-1.5 text-xs px-3"
              >
                <Eye className="size-3.5" />
                Preview
              </TabsTrigger>
              <TabsTrigger
                value="code"
                className="flex items-center gap-1.5 text-xs px-3"
              >
                <Code className="size-3.5" />
                Code Editor
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex items-center gap-1">
            <TooltipProvider>
              {localViewMode === "preview" && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={refreshPreview}
                      >
                        <RefreshCw className="size-4" />
                        <span className="sr-only">Refresh Preview</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Refresh Preview</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={openInNewTab}
                      >
                        <ExternalLink className="size-4" />
                        <span className="sr-only">Open in New Tab</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Open in New Tab</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}

              {localViewMode === "code" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={copyToClipboard}
                    >
                      {isCopied ? (
                        <CheckCircle className="size-4 text-green-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      <span className="sr-only">Copy Code</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{isCopied ? "Copied!" : "Copy Code"}</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>
        </div>

        <TabsContent
          value="code"
          className="flex-1 m-0 p-0 data-[state=active]:flex flex-col h-full"
        >
          <CodeEditor
            content={content}
            onSaveContent={onSaveContent}
            status={status}
            isCurrentVersion={isCurrentVersion}
            currentVersionIndex={currentVersionIndex}
          />
        </TabsContent>

        <TabsContent
          value="preview"
          className="flex-1 m-0 p-0 data-[state=active]:flex flex-col"
        >
          <div className="flex-1 size-full overflow-x-hidden overflow-y-auto bg-background rounded-sm p-1">
            <div className="bg-foreground rounded-sm size-full">
              <iframe
                key={previewKey}
                srcDoc={content}
                sandbox="allow-scripts allow-same-origin"
                title="HTML Preview"
                className="size-full border-0"
                style={{ minHeight: "400px" }}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export const htmlArtifact = new Artifact<"html", Metadata>({
  kind: "html",
  description: "Useful for generating and previewing HTML content.",
  onStreamPart: ({ streamPart, setArtifact }) => {
    // Type check needs update elsewhere (DataStreamDelta type)
    if (streamPart.type === "html-delta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: (draftArtifact.content || "") + (streamPart.content as string),
        isVisible:
          draftArtifact.status === "streaming" &&
          draftArtifact.content.length > 100 &&
          draftArtifact.content.length < 110
            ? true
            : draftArtifact.isVisible,
        status: "streaming",
      }));
    } else if (streamPart.type === "html") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.content as string,
        isVisible: true,
        status: "idle",
      }));
    }
  },
  content: (props) => <HtmlArtifactDisplay {...props} />,
  actions: [
    {
      icon: <UndoIcon size={18} />,
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ documents, currentVersionIndex }) =>
        !documents || currentVersionIndex === documents.length - 1,
    },
    {
      icon: <CopyIcon size={18} />,
      description: "Copy HTML code to clipboard",
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success("HTML copied to clipboard!");
      },
    },
  ],
  toolbar: [
    {
      icon: <MessageIcon />,
      description: "Improve this HTML",
      onClick: ({ appendMessage }) => {
        appendMessage({
          role: "user",
          content: "Improve this HTML code.",
        });
      },
    },
  ],
});
