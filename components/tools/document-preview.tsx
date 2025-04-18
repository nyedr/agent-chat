"use client";

import {
  memo,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { ArtifactKind, UIArtifact } from "@/components/artifact";
import {
  FileIcon,
  FullscreenIcon,
  ImageIcon,
  LoaderIcon,
} from "@/components/icons";
import { cn, fetcher } from "@/lib/utils";
import { Document } from "@/lib/db/schema";
import { InlineDocumentSkeleton } from "./document-skeleton";
import useSWR from "swr";
import { Editor } from "@/components/text-editor";
import { DocumentToolCall, DocumentToolResult } from "./document";
import { CodeEditor } from "@/components/code-editor";
import { useArtifact } from "@/hooks/use-artifact";
import equal from "fast-deep-equal";
import { SpreadsheetEditor } from "@/components/sheet-editor";
import { ImageEditor } from "@/components/image-editor";
import { HtmlArtifactDisplay } from "@/artifacts/html/client";

interface DocumentPreviewProps {
  isReadonly: boolean;
  result?: any;
  args?: any;
  initialData?: {
    title: string;
    kind: ArtifactKind;
    content: string;
    extension?: string;
  };
}

export function DocumentPreview({
  isReadonly,
  result,
  args,
  initialData,
}: DocumentPreviewProps) {
  const { artifact, setArtifact } = useArtifact();

  const shouldFetch = !initialData && result?.id;
  const { data: documents, isLoading: isDocumentsFetching } = useSWR<
    Array<Document>
  >(shouldFetch ? `/api/document?id=${result.id}` : null, fetcher);

  const previewDocument = useMemo(() => documents?.[0], [documents]);
  const hitboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const boundingBox = hitboxRef.current?.getBoundingClientRect();

    if (artifact.documentId && boundingBox && result?.id) {
      setArtifact((artifact) => ({
        ...artifact,
        boundingBox: {
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
      }));
    }
  }, [artifact.documentId, setArtifact, result?.id]);

  const documentData: Document | null = useMemo(() => {
    if (initialData) {
      return {
        title: initialData.title,
        kind: initialData.kind,
        content: initialData.content,
        id: `preview-${Date.now()}`,
        createdAt: new Date().toISOString(),
        chatId: "noop",
        extension: initialData.extension || "txt",
      };
    }
    if (previewDocument) {
      return previewDocument;
    }
    if (artifact.status === "streaming") {
      return {
        title: artifact.title,
        kind: artifact.kind,
        content: artifact.content,
        id: artifact.documentId,
        createdAt: new Date().toISOString(),
        chatId: "noop",
        extension: "txt",
      };
    }
    return null;
  }, [initialData, previewDocument, artifact]);

  if (artifact.isVisible && !initialData) {
    if (result) {
      return (
        <DocumentToolResult
          type="create"
          result={{ id: result.id, title: result.title, kind: result.kind }}
          isReadonly={isReadonly}
        />
      );
    }

    if (args) {
      return (
        <DocumentToolCall
          type="create"
          args={{ title: args.title }}
          isReadonly={isReadonly}
        />
      );
    }
  }

  if (shouldFetch && isDocumentsFetching) {
    return <LoadingSkeleton artifactKind={result.kind ?? args.kind} />;
  }

  if (!documentData) {
    const skeletonKind =
      initialData?.kind || result?.kind || args?.kind || "text";
    return <LoadingSkeleton artifactKind={skeletonKind} />;
  }

  return (
    <div className="relative w-full cursor-pointer">
      {result?.id && (
        <HitboxLayer
          hitboxRef={hitboxRef}
          result={result}
          setArtifact={setArtifact}
        />
      )}
      <DocumentHeader
        title={documentData.title}
        kind={documentData.kind}
        isStreaming={!initialData && artifact.status === "streaming"}
      />
      <DocumentContent document={documentData} />
    </div>
  );
}

const LoadingSkeleton = ({ artifactKind }: { artifactKind: ArtifactKind }) => (
  <div className="w-full">
    <div className="p-4 border rounded-t-2xl flex flex-row gap-2 items-center justify-between dark:bg-muted h-[57px] dark:border-zinc-700 border-b-0">
      <div className="flex flex-row items-center gap-3">
        <div className="text-muted-foreground">
          <div className="animate-pulse rounded-md size-4 bg-muted-foreground/20" />
        </div>
        <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-24" />
      </div>
      <div>
        <FullscreenIcon />
      </div>
    </div>
    {artifactKind === "image" ? (
      <div className="overflow-y-scroll border rounded-b-2xl bg-muted border-t-0 dark:border-zinc-700">
        <div className="animate-pulse h-[257px] bg-muted-foreground/20 w-full" />
      </div>
    ) : (
      <div className="overflow-y-scroll border rounded-b-2xl p-8 pt-4 bg-muted border-t-0 dark:border-zinc-700">
        <InlineDocumentSkeleton />
      </div>
    )}
  </div>
);

const PureHitboxLayer = ({
  hitboxRef,
  result,
  setArtifact,
}: {
  hitboxRef: React.RefObject<HTMLDivElement>;
  result: any;
  setArtifact: (
    updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)
  ) => void;
}) => {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const boundingBox = event.currentTarget.getBoundingClientRect();

      setArtifact((artifact) =>
        artifact.status === "streaming"
          ? { ...artifact, isVisible: true }
          : {
              ...artifact,
              title: result.title,
              documentId: result.id,
              kind: result.kind,
              isVisible: true,
              boundingBox: {
                left: boundingBox.x,
                top: boundingBox.y,
                width: boundingBox.width,
                height: boundingBox.height,
              },
            }
      );
    },
    [setArtifact, result]
  );

  return (
    <div
      className="size-full absolute top-0 left-0 rounded-xl z-10"
      ref={hitboxRef}
      onClick={handleClick}
      role="presentation"
      aria-hidden="true"
    >
      <div className="w-full p-4 flex justify-end items-center">
        <div className="absolute right-[9px] top-[13px] p-2 hover:dark:bg-zinc-700 rounded-md hover:bg-zinc-100">
          <FullscreenIcon />
        </div>
      </div>
    </div>
  );
};

const HitboxLayer = memo(PureHitboxLayer, (prevProps, nextProps) => {
  if (!equal(prevProps.result, nextProps.result)) return false;
  return true;
});

const PureDocumentHeader = ({
  title,
  kind,
  isStreaming,
}: {
  title: string;
  kind: ArtifactKind;
  isStreaming: boolean;
}) => (
  <div className="p-4 border rounded-t-2xl flex flex-row gap-2 items-start sm:items-center justify-between dark:bg-muted border-b-0 dark:border-zinc-700">
    <div className="flex flex-row items-start sm:items-center gap-3">
      <div className="text-muted-foreground">
        {isStreaming ? (
          <div className="animate-spin">
            <LoaderIcon />
          </div>
        ) : kind === "image" ? (
          <ImageIcon />
        ) : (
          <FileIcon />
        )}
      </div>
      <div className="-translate-y-1 sm:translate-y-0 font-medium">{title}</div>
    </div>
    <div className="w-8" />
  </div>
);

const DocumentHeader = memo(PureDocumentHeader, (prevProps, nextProps) => {
  if (prevProps.title !== nextProps.title) return false;
  if (prevProps.isStreaming !== nextProps.isStreaming) return false;

  return true;
});

const DocumentContent = ({ document }: { document: Document }) => {
  const { artifact, metadata, setMetadata, setArtifact } = useArtifact();

  const containerClassName = cn(
    "h-[257px] overflow-y-scroll border rounded-b-2xl dark:bg-muted border-t-0 dark:border-zinc-700",
    {
      "p-4 sm:px-14 sm:py-16": document.kind === "text",
      "p-0": document.kind === "code" || document.kind === "html",
    }
  );

  const commonProps = {
    content: document.content ?? "",
    isCurrentVersion: true,
    currentVersionIndex: 0,
    status: artifact.status,
    onSaveContent: () => {},
    mode: metadata?.mode || "view",
  };

  return (
    <div className={containerClassName}>
      {document.kind === "text" ? (
        <Editor {...commonProps} />
      ) : document.kind === "code" ? (
        <div className="flex flex-1 relative w-full">
          <div className="absolute inset-0">
            <CodeEditor {...commonProps} />
          </div>
        </div>
      ) : document.kind === "sheet" ? (
        <div className="flex flex-1 relative size-full p-4">
          <div className="absolute inset-0">
            <SpreadsheetEditor
              {...commonProps}
              saveContent={commonProps.onSaveContent}
            />
          </div>
        </div>
      ) : document.kind === "image" ? (
        <ImageEditor
          title={document.title}
          content={document.content ?? ""}
          isCurrentVersion={true}
          currentVersionIndex={0}
          status={artifact.status}
          isInline={true}
        />
      ) : document.kind === "html" ? (
        <div className="flex flex-1 relative w-full">
          <div className="absolute inset-0">
            <HtmlArtifactDisplay
              content={document.content ?? ""}
              metadata={metadata as any}
              setMetadata={setMetadata as any}
              isLoading={false}
              onSaveContent={commonProps.onSaveContent}
              status={artifact.status}
              isCurrentVersion={commonProps.isCurrentVersion}
              currentVersionIndex={commonProps.currentVersionIndex}
              mode={commonProps.mode}
              setArtifact={setArtifact}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
