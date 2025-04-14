import React from "react";
import { ToolReturnTypes } from "@/lib/ai/tools";
import ReactDiffViewer from "react-diff-viewer";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { nightOwl } from "react-syntax-highlighter/dist/esm/styles/prism";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import { AlertCircle, CheckCircle } from "lucide-react";

SyntaxHighlighter.registerLanguage("diff", diff);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("javascript", javascript);

interface EditDocumentResultProps {
  result: ToolReturnTypes["editDocument"];
}

export const EditDocumentResultComponent: React.FC<EditDocumentResultProps> = ({
  result,
}) => {
  const highlightSyntax = (str: string | undefined) => {
    if (!str) return <></>;
    const language = result.extension || "diff";
    return (
      <SyntaxHighlighter
        language={language}
        style={nightOwl}
        customStyle={{
          display: "inline",
          padding: "0",
          margin: "0",
          background: "transparent",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
        }}
        codeTagProps={{ style: { display: "inline" } }}
      >
        {str}
      </SyntaxHighlighter>
    );
  };

  return (
    <div className="rounded-md bg-muted/30 mt-3">
      <div className="flex items-center mb-3">
        {result.error ? (
          <AlertCircle className="size-4 text-red-500 mr-2" />
        ) : (
          <CheckCircle className="size-4 text-green-500 mr-2" />
        )}
        <p className={result.error ? "text-red-600" : "text-foreground"}>
          {result.message}
        </p>
      </div>
      {result.oldContent !== undefined && result.newContent !== undefined && (
        <div className="mt-2 border rounded-md overflow-hidden bg-background">
          <div className="px-3 py-1.5 text-xs border-b bg-muted/50 text-muted-foreground">
            Showing changes for: {result.message.split(" ").pop()}
          </div>
          <ReactDiffViewer
            oldValue={result.oldContent}
            newValue={result.newContent}
            renderContent={highlightSyntax}
            useDarkTheme={true}
            showDiffOnly={true}
            splitView={false}
            styles={{
              content: {
                fontSize: "14px",
                overflowX: "auto",
              },
              line: {
                overflowX: "auto",
              },
            }}
          />
        </div>
      )}
    </div>
  );
};
