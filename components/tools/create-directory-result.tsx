import React from "react";
import { ToolReturnTypes } from "@/lib/ai/tools";
import { AlertCircle, CheckCircle, Folder } from "lucide-react";

interface CreateDirectoryResultProps {
  result: ToolReturnTypes["createDirectory"];
}

export const CreateDirectoryResultComponent: React.FC<
  CreateDirectoryResultProps
> = ({ result }) => {
  return (
    <div className="p-4 border rounded-md bg-muted/30 text-sm">
      <div className="flex items-center">
        {result.error ? (
          <AlertCircle className="size-4 text-red-500 mr-2 shrink-0" />
        ) : (
          <CheckCircle className="size-4 text-green-500 mr-2 shrink-0" />
        )}
        <div className="flex flex-col min-w-0">
          <p className={result.error ? "text-red-600" : "text-foreground"}>
            {result.message}
          </p>
          {!result.error && (
            <p className="flex items-center text-muted-foreground truncate">
              <Folder className="size-3 mr-1 shrink-0" />
              <span className="truncate">{result.path}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
