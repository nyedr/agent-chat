"use client";

import { exampleSetup } from "prosemirror-example-setup";
import { inputRules } from "prosemirror-inputrules";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import React, { memo, useEffect, useRef } from "react";

import {
  documentSchema,
  handleTransaction,
  headingRule,
} from "@/lib/editor/config";
import {
  buildContentFromDocument,
  buildDocumentFromContent,
} from "@/lib/editor/functions";

export type EditorProps = {
  content: string;
  onSaveContent: (updatedContent: string, debounce: boolean) => void;
  status: "streaming" | "idle";
  isCurrentVersion: boolean;
  currentVersionIndex: number;
};

function PureEditor({ content, onSaveContent, status }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (containerRef.current && !editorRef.current) {
      const startState = EditorState.create({
        doc: buildDocumentFromContent(content),
        plugins: [
          ...exampleSetup({
            schema: documentSchema,
            menuBar: false,
          }),
          inputRules({ rules: [headingRule(1)] }),
        ],
      });

      editorRef.current = new EditorView(containerRef.current, {
        state: startState,
        dispatchTransaction: (transaction) =>
          handleTransaction({
            transaction,
            editorRef,
            saveContent: onSaveContent,
          }),
      });
    }

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editorRef.current && content !== undefined) {
      const currentContent = buildContentFromDocument(
        editorRef.current.state.doc
      );

      if (status === "streaming" || currentContent !== content) {
        const newDoc = buildDocumentFromContent(content);
        const transaction = editorRef.current.state.tr.replaceWith(
          0,
          editorRef.current.state.doc.content.size,
          newDoc
        );
        editorRef.current.dispatch(transaction);
      }
    }
  }, [content, status]);

  return (
    <div
      className="relative prose max-w-full dark:prose-invert prose-headings:font-medium prose-headings:tracking-tight prose-h1:font-semibold prose-h1:text-3xl prose-p:leading-7 prose-code:before:content-none prose-code:after:content-none prose-blockquote:not-italic"
      ref={containerRef}
    />
  );
}

function areEqual(prevProps: EditorProps, nextProps: EditorProps) {
  return (
    prevProps.currentVersionIndex === nextProps.currentVersionIndex &&
    prevProps.isCurrentVersion === nextProps.isCurrentVersion &&
    !(prevProps.status === "streaming" && nextProps.status === "streaming") &&
    prevProps.content === nextProps.content
  );
}

export const Editor = memo(PureEditor, areEqual);
