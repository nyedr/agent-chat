import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ExtractStructuredDataToolResult } from "@/lib/ai/tools/extract-structured-data";

interface ExtractStructuredDataResultProps {
  result: ExtractStructuredDataToolResult;
}

export function ExtractStructuredDataResult({
  result,
}: ExtractStructuredDataResultProps) {
  // Early return if there's an error
  if (!result.success || result.error) {
    return (
      <Card className="w-full overflow-hidden">
        <CardHeader className="bg-destructive/10 p-3">
          <CardTitle className="text-sm font-medium">
            Extraction Failed
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 text-sm text-muted-foreground">
          {result.error || "Unable to extract structured data"}
        </CardContent>
      </Card>
    );
  }

  // Get data as an object
  const data = result.data || {};
  const isEmpty = Object.keys(data).length === 0;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="bg-muted/50 p-3">
        <CardTitle className="text-sm font-medium">
          Structured Data {isEmpty ? "(Empty)" : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 text-xs text-muted-foreground">
          <span className="font-medium">Source:</span> {result.source}
        </div>

        {isEmpty ? (
          <div className="text-sm text-muted-foreground">
            No data was extracted. This might be because:
            <ul className="list-disc pl-5 mt-1">
              <li>The schema fields don&apos;t match available content</li>
              <li>
                The source content doesn&apos;t contain the expected information
              </li>
              <li>
                The extraction process couldn&apos;t identify matching content
              </li>
            </ul>
            Try modifying the schema to better match the available content.
          </div>
        ) : (
          <div className="rounded-md bg-muted p-3 overflow-auto max-h-[400px]">
            <pre className="text-xs text-foreground whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">Schema:</span>{" "}
          <code className="font-mono text-xs bg-muted rounded-sm px-1 py-0.5">
            {result.schema}
          </code>
        </div>
      </CardContent>
    </Card>
  );
}
