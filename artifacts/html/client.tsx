import { Artifact, ArtifactContent } from "@/components/create-artifact";
import { CodeEditor, EditorProps } from "@/components/code-editor";
import { CopyIcon, MessageIcon, RedoIcon, UndoIcon } from "@/components/icons";
import { toast } from "sonner";
import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent } from "@/components/ui/tabs";

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
        value={metadata?.viewMode || "preview"}
        onValueChange={(value) => {
          const newMode = value as "code" | "preview";
          console.log("[HtmlArtifactDisplay] Tab changed to value:", newMode);
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
          <div className="flex-1 size-full overflow-x-hidden overflow-y-auto bg-background">
            <div className="bg-foreground rounded-sm size-full">
              <iframe
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
