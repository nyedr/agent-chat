"use client";

import { type FC } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nightOwl } from "react-syntax-highlighter/dist/cjs/styles/prism";
import CopyButton from "./ui/copy-button";
import { capitalize } from "@/lib/utils";

interface CodeBlockProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
  language: string;
}

export const CodeBlock: FC<CodeBlockProps> = ({
  node,
  inline,
  className,
  children,
  language,
  ...props
}) => {
  return (
    <div className="flex max-w-3xl flex-col border border-border rounded-md my-2">
      <div className="flex flex-row items-center justify-between p-1 px-3 bg-muted rounded-t-md">
        <div className="flex flex-row gap-2">{capitalize(language)}</div>
        <CopyButton content={String(children)} />
      </div>
      <SyntaxHighlighter
        style={nightOwl}
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          backgroundColor: "#282A36",
        }}
        PreTag="div"
        language={language}
        className="highlight-code my-0 rounded-t-none p-2 rounded-md max-w-3xl overflow-x-auto size-full min-w-0"
        {...props}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
};
