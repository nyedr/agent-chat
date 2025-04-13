import React from "react";
import { AlertCircle, FileText, Folder, FileLock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ToolReturnTypes } from "@/lib/ai/tools";
import { formatFileSize } from "@/lib/utils";

interface GetFileInfoResultProps {
  result: ToolReturnTypes["getFileInfo"];
}

export const GetFileInfoResultComponent: React.FC<GetFileInfoResultProps> = ({
  result,
}) => {
  if (result.error) {
    return (
      <div className="p-4 border rounded-md bg-red-50 dark:bg-red-900/30 text-sm flex items-center">
        <AlertCircle className="size-4 text-red-500 mr-2 shrink-0" />
        <p className="text-red-600 dark:text-red-400">{result.error}</p>
      </div>
    );
  }

  if (!result.info) {
    // Should not happen if error is not present, but good practice
    return (
      <div className="p-4 border rounded-md bg-muted/30 text-sm">
        <p>No file information available.</p>
      </div>
    );
  }

  const { info } = result;
  const Icon = info.type === "directory" ? Folder : FileText;

  return (
    <div className="p-4 border rounded-md bg-muted/30 text-sm space-y-2">
      <div className="flex items-center font-medium">
        <Icon className="size-4 mr-2 shrink-0" />
        <span className="truncate" title={info.path}>
          {info.name}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div>Type:</div>
        <div>{info.type}</div>
        {info.type === "file" && (
          <>
            <div>Size:</div>
            <div>{formatFileSize(info.size)}</div>
          </>
        )}
        <div>Modified:</div>
        <div>
          {formatDistanceToNow(new Date(info.modifiedAt), { addSuffix: true })}
        </div>
        <div>Created:</div>
        <div>
          {formatDistanceToNow(new Date(info.createdAt), { addSuffix: true })}
        </div>
        <div>Permissions:</div>
        <div className="flex items-center">
          <FileLock className="size-3 mr-1" />
          <span>{info.permissions}</span>
        </div>
      </div>
    </div>
  );
};
