"use client";

import { useEffect, useRef } from "react";
import { BlockKind } from "./block";
import { initialBlockData, useBlock } from "@/hooks/use-block";
import { useDeepResearch } from "@/lib/deep-research-context";
import { useChat } from "@ai-sdk/react";

// Expanded type to include all expected custom data payloads
export type DataStreamDelta = {
  type:
    | "text-delta"
    | "code-delta"
    | "spreadsheet-delta"
    | "title"
    | "id"
    | "suggestion"
    | "clear"
    | "finish"
    | "user-message-id"
    | "kind"
    // Deep Research specific types
    | "progress-init"
    | "depth-delta"
    | "activity-delta" // May contain steps
    | "activity" // Handle potential variation
    | "source-delta"
    | "warning" // Handle potential warning type
    | "complete" // Backend sends this on success
    | "error"; // Backend sends this on error
  content: any; // Use 'any' for simplicity, parse based on type
};

export function DataStreamHandler({ id }: { id: string }) {
  const { data: dataStream } = useChat({ id });
  const { setBlock } = useBlock();
  const { addActivity, addSource, initProgress, setDepth, updateProgress } =
    useDeepResearch();
  const lastProcessedIndex = useRef(-1);
  const researchCompleted = useRef(false);

  useEffect(() => {
    if (!dataStream?.length) return;

    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);
    lastProcessedIndex.current = dataStream.length - 1;

    (newDeltas as DataStreamDelta[]).forEach((delta: DataStreamDelta) => {
      console.log("[DataStreamHandler] Processing delta:", delta); // Log every delta

      // Stop processing deep research deltas if completion signal received
      if (
        researchCompleted.current &&
        [
          "progress-init",
          "depth-delta",
          "activity-delta",
          "activity",
          "source-delta",
          "warning",
          "complete",
          "error",
        ].includes(delta.type)
      ) {
        console.log(
          "[DataStreamHandler] Ignoring deep research delta after completion:",
          delta.type
        );
        return;
      }

      // --- Handle Deep Research Updates ---
      if (delta.type === "progress-init") {
        const { maxDepth, totalSteps } = delta.content;
        console.log("[DataStreamHandler] Handling progress-init:", {
          maxDepth,
          totalSteps,
        });
        initProgress(maxDepth, totalSteps);
        researchCompleted.current = false; // Reset completion flag on new init
        return; // Handled, exit early
      }
      if (delta.type === "depth-delta") {
        const { current, max } = delta.content;
        console.log("[DataStreamHandler] Handling depth-delta:", {
          current,
          max,
        });
        setDepth(current, max);
        return; // Handled, exit early
      }
      if (delta.type === "activity-delta" || delta.type === "activity") {
        const activity = delta.content; // content should match ActivityItem + optional steps
        console.log(`[DataStreamHandler] Handling ${delta.type}:`, activity);
        addActivity(activity);
        // Check for step updates within the activity payload
        if (
          activity.completedSteps !== undefined &&
          activity.totalSteps !== undefined
        ) {
          console.log("[DataStreamHandler] Updating progress from activity:", {
            completed: activity.completedSteps,
            total: activity.totalSteps,
          });
          updateProgress(activity.completedSteps, activity.totalSteps);
        }
        return; // Handled, exit early
      }
      if (delta.type === "source-delta") {
        const source = delta.content; // content should match SourceItem
        console.log("[DataStreamHandler] Handling source-delta:", source);
        addSource(source);
        return; // Handled, exit early
      }
      if (delta.type === "warning") {
        console.warn(
          "[DataStreamHandler] Received warning delta:",
          delta.content
        );
        // Optionally display warning to user or log it
        return; // Handled (by logging/warning), exit early
      }
      // Handle completion/error signals from the deep research stream
      if (delta.type === "complete" || delta.type === "error") {
        console.log(
          `[DataStreamHandler] Received final deep research signal: ${delta.type}`
        );
        researchCompleted.current = true; // Set completion flag
        // The main tool result handling in message.tsx should take over now.
        return;
      }

      // --- Handle Block Context Updates (Original Logic) ---
      if (delta.type === "user-message-id") {
        // This likely relates to message sync, not block or research state
        return;
      }

      // Only update block if it's not a deep research type handled above
      setBlock((draftBlock) => {
        if (!draftBlock) {
          return { ...initialBlockData, status: "streaming" };
        }

        switch (delta.type) {
          case "id":
            return {
              ...draftBlock,
              documentId: delta.content as string,
              status: "streaming",
            };

          case "title":
            return {
              ...draftBlock,
              title: delta.content as string,
              status: "streaming",
            };

          case "kind":
            return {
              ...draftBlock,
              kind: delta.content as BlockKind,
              status: "streaming",
            };

          case "text-delta":
            return {
              ...draftBlock,
              content: draftBlock.content + (delta.content as string),
              isVisible:
                draftBlock.status === "streaming" &&
                draftBlock.content.length > 400 &&
                draftBlock.content.length < 450
                  ? true
                  : draftBlock.isVisible,
              status: "streaming",
            };

          case "code-delta":
            return {
              ...draftBlock,
              content: delta.content as string,
              isVisible:
                draftBlock.status === "streaming" &&
                draftBlock.content.length > 300 &&
                draftBlock.content.length < 310
                  ? true
                  : draftBlock.isVisible,
              status: "streaming",
            };
          case "spreadsheet-delta":
            return {
              ...draftBlock,
              content: delta.content as string,
              isVisible: true,
              status: "streaming",
            };

          case "clear":
            return {
              ...draftBlock,
              content: "",
              status: "streaming",
            };

          case "finish":
            return {
              ...draftBlock,
              status: "idle",
            };

          default:
            console.warn(
              "[DataStreamHandler] Unhandled delta type for block update:",
              delta.type
            );
            return draftBlock;
        }
      });
    });
  }, [
    dataStream,
    setBlock,
    addActivity,
    addSource,
    initProgress,
    setDepth,
    updateProgress,
  ]);

  return null;
}
