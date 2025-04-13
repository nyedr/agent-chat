"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ListDirectoryToolResult,
  FileEntry,
} from "@/lib/ai/tools/list-directory";
import {
  Folder,
  FileText,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  FolderOpen,
  Clock,
  HardDrive,
  ArrowUpDown,
  Search,
  Eye,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cn,
  formatFileSize,
  formatRelativeDate,
  getFileTypeFromExtension,
  getFileIcon,
  getFileInfoFromUrl,
  fileTypeToArtifactKind,
} from "@/lib/utils";
import { useArtifact } from "@/hooks/use-artifact";
import { toast } from "sonner";

interface ListDirectoryResultProps {
  result: ListDirectoryToolResult;
  chatId: string;
}

type SortField = "name" | "size" | "lastModified";
type SortDirection = "asc" | "desc";

export function ListDirectoryResult({
  result,
  chatId,
}: ListDirectoryResultProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const { setArtifact } = useArtifact();

  // Calculate derived state
  const files = useMemo(() => result?.files || [], [result?.files]);
  const isEmpty = files.length === 0;
  const dirCount = useMemo(
    () => files.filter((item) => item.type === "directory").length,
    [files]
  );
  const fileCount = useMemo(() => files.length - dirCount, [files, dirCount]);

  // Filter and sort files
  const filteredAndSortedFiles = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = query
      ? files.filter((item) => item.name.toLowerCase().includes(query))
      : files;

    return [...filtered].sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "size":
          comparison =
            (a.size ?? (a.type === "directory" ? -1 : 0)) -
            (b.size ?? (b.type === "directory" ? -1 : 0));
          break;
        case "lastModified":
          comparison =
            (a.lastModified ? new Date(a.lastModified).getTime() : 0) -
            (b.lastModified ? new Date(b.lastModified).getTime() : 0);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [files, searchQuery, sortField, sortDirection]);

  // --- Click Handlers Defined Inside ---
  const handleFileClick = async (file: FileEntry) => {
    setViewingFile(file.name);
    const basePath = result?.path || "";
    const filePath = basePath ? `${basePath}/${file.name}` : file.name;
    const fileUrl = `/api/uploads/${chatId}/${filePath}`;
    const { fileType, displayFilename } = getFileInfoFromUrl(
      fileUrl,
      file.name
    );
    const artifactKind = fileTypeToArtifactKind[fileType];

    if (!artifactKind) {
      toast.info(`Preview not available for ${fileType} files.`);
      setViewingFile(null);
      return;
    }

    try {
      const response = await fetch(fileUrl);
      if (!response.ok)
        throw new Error(`Failed to fetch: ${response.statusText}`);
      let content: string;
      if (artifactKind === "image") {
        const blob = await response.blob();
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
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
        documentId: `preview:${fileUrl}`,
        content: content,
        kind: artifactKind,
        title: displayFilename,
        status: "idle",
        isVisible: true,
        boundingBox: { top: 0, left: 0, width: 0, height: 0 },
      });
    } catch (error) {
      console.error("Error loading file into artifact:", error);
      toast.error(
        `Failed to load file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setViewingFile(null);
    }
  };

  const handleFolderClick = (folder: FileEntry) => {
    const basePath = result?.path || "";
    const newPath = basePath ? `${basePath}/${folder.name}` : folder.name;
    console.log(`Simulating tool call: listDirectory({ path: "${newPath}" })`);
    toast.info(
      `Opening folder: ${newPath} (Simulation - Tool call needs external integration)`
    );
  };
  // --- End Handlers ---

  // Error handling
  if (!result || result.error) {
    return (
      <Card className="w-full overflow-hidden border-destructive/30 font-sans">
        <CardHeader className="bg-destructive/10 p-4 flex flex-row items-center gap-2">
          <AlertCircle className="size-5 text-destructive shrink-0" />
          <CardTitle className="text-sm font-medium">
            Directory Listing Failed
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm">
          <p className="text-muted-foreground">
            {result?.error || "Unable to list directory content."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field)
      return <ArrowUpDown className="size-3.5 opacity-50" />;
    return sortDirection === "asc" ? (
      <ChevronUp className="size-3.5" />
    ) : (
      <ChevronDown className="size-3.5" />
    );
  };

  return (
    <TooltipProvider>
      <Card className="w-full font-['Noto_Sans'] overflow-hidden border-border/70">
        <CardHeader className="bg-background p-4 border-b border-border/70">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="size-5 text-primary shrink-0" />
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  Directory:
                  <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                    {result.path || "/"}
                  </code>
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="h-6 gap-1 text-xs font-normal text-muted-foreground"
                    >
                      <Folder className="size-3.5" /> {dirCount}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {dirCount} {dirCount === 1 ? "directory" : "directories"}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="h-6 gap-1 text-xs font-normal text-muted-foreground"
                    >
                      <FileText className="size-3.5" /> {fileCount}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {fileCount} {fileCount === 1 ? "file" : "files"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            {!isEmpty && (
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={`Search in ${result.path || "/"}...`}
                  className="pl-9 h-9 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 bg-background">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <FolderOpen className="size-12 text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-medium mb-1">This folder is empty</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                There are no files or subfolders in this directory.
              </p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur-sm">
                  <tr>
                    <th className="font-medium text-left px-4 py-2 w-full">
                      <button
                        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleSort("name")}
                      >
                        Name {renderSortIcon("name")}
                      </button>
                    </th>
                    <th className="font-medium text-right px-3 py-2 whitespace-nowrap">
                      <button
                        className="flex items-center gap-1 ml-auto text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleSort("size")}
                      >
                        Size {renderSortIcon("size")}
                      </button>
                    </th>
                    <th className="font-medium text-right px-4 py-2 whitespace-nowrap">
                      <button
                        className="flex items-center gap-1 ml-auto text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => handleSort("lastModified")}
                      >
                        Modified {renderSortIcon("lastModified")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedFiles.length > 0 ? (
                    filteredAndSortedFiles.map((item) => {
                      const extension = item.name.includes(".")
                        ? item.name.split(".").pop()?.toLowerCase() || ""
                        : "";
                      const fileType = getFileTypeFromExtension(extension);
                      const IconComponent = getFileIcon(fileType);
                      const artifactKind = fileTypeToArtifactKind[fileType];
                      const isFileViewable = artifactKind !== null;
                      const isClickable =
                        item.type === "directory" ||
                        (item.type === "file" && isFileViewable);
                      const isLoadingThisFile = viewingFile === item.name;

                      return (
                        <tr
                          key={item.name}
                          className={cn(
                            "border-t border-border/50",
                            isClickable &&
                              !isLoadingThisFile &&
                              "cursor-pointer hover:bg-accent/50 transition-colors",
                            isLoadingThisFile && "opacity-60 cursor-default"
                          )}
                          onClick={() => {
                            if (isLoadingThisFile) return;
                            if (item.type === "directory")
                              handleFolderClick(item);
                            else if (item.type === "file" && isFileViewable)
                              handleFileClick(item);
                            else if (item.type === "file" && !isFileViewable)
                              toast.info(
                                `Preview not available for this file type.`
                              );
                          }}
                        >
                          <td className="px-4 py-2.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {isLoadingThisFile ? (
                                    <Loader2 className="size-4 text-muted-foreground shrink-0 animate-spin" />
                                  ) : item.type === "directory" ? (
                                    <Folder className="size-4 text-primary shrink-0" />
                                  ) : (
                                    <IconComponent className="size-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <span
                                    className={cn(
                                      "truncate font-medium",
                                      isLoadingThisFile &&
                                        "italic text-muted-foreground"
                                    )}
                                    title={item.name}
                                  >
                                    {item.name}
                                  </span>
                                  {isFileViewable &&
                                    item.type === "file" &&
                                    !isLoadingThisFile && (
                                      <Eye
                                        className="size-3.5 ml-1 text-muted-foreground/60 shrink-0"
                                        aria-label="Viewable"
                                      />
                                    )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                {item.name}
                                {isLoadingThisFile
                                  ? " (Loading...)"
                                  : isFileViewable && item.type === "file"
                                  ? " (Click to view)"
                                  : item.type === "directory"
                                  ? " (Click to open)"
                                  : ""}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                            {item.type === "directory" ? (
                              <span className="text-muted-foreground/60">
                                —
                              </span>
                            ) : item.size !== undefined ? (
                              <div
                                className="flex items-center justify-end gap-1.5"
                                title={`Size: ${item.size} bytes`}
                              >
                                <HardDrive className="size-3.5 text-muted-foreground/60" />
                                {formatFileSize(item.size)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/60">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                            {item.lastModified ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Clock className="size-3.5 text-muted-foreground/60" />
                                    {formatRelativeDate(item.lastModified)}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {new Date(item.lastModified).toLocaleString()}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground/60">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={3}
                        className="p-8 text-center text-muted-foreground border-t border-border/50"
                      >
                        <Search className="size-8 mx-auto mb-2 text-muted-foreground/40" />
                        No files match your search.
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 ml-1"
                          onClick={() => setSearchQuery("")}
                        >
                          Clear search
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
