"use client";

import type React from "react";
import type { FC } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nightOwl } from "react-syntax-highlighter/dist/cjs/styles/prism";
import CopyButton from "./ui/copy-button";
import { capitalize, cn } from "@/lib/utils";

interface CodeBlockProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
  language: string;
  result?: string;
  useMinimal?: boolean;
}

export const CodeBlock: FC<CodeBlockProps> = ({
  node,
  inline,
  className,
  children,
  language,
  result,
  useMinimal,
  ...props
}) => {
  const hasResult = Boolean(result);
  const codeContent =
    typeof children === "string"
      ? children
      : String(children).replace(/\n$/, "");

  return (
    <div
      className={cn(
        "flex max-w-3xl flex-col border border-border font-['Noto_Sans']",
        {
          "my-2 rounded-md": !useMinimal && !hasResult,
        }
      )}
    >
      {!hasResult && (
        <div className="flex flex-row items-center justify-between p-1 px-3 bg-muted text-muted-foreground">
          <div className="flex flex-row gap-2 text-sm">
            {capitalize(language)}
          </div>
          <CopyButton content={codeContent} />
        </div>
      )}
      <SyntaxHighlighter
        style={nightOwl}
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          backgroundColor: "#282A36",
          borderBottomLeftRadius: hasResult || useMinimal ? 0 : undefined,
          borderBottomRightRadius: hasResult || useMinimal ? 0 : undefined,
          fontSize: "0.875rem",
        }}
        PreTag="div"
        language={language}
        className="highlight-code my-0 p-2 max-w-3xl overflow-x-auto size-full min-w-0"
        {...props}
      >
        {codeContent}
      </SyntaxHighlighter>

      {hasResult && (
        <div className="border-t border-border bg-accent text-secondary-foreground font-['Noto_Sans']">
          <div className="px-4 py-2 text-sm text-muted-foreground">Result</div>
          <div className="px-4 pb-3 whitespace-pre-wrap text-sm">{result}</div>
        </div>
      )}
    </div>
  );
};
