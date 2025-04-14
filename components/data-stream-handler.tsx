"use client";

import { useEffect, useRef } from "react";
import { useDeepResearch } from "@/lib/deep-research-context";
import { useChat } from "@ai-sdk/react";
import { initialArtifactData, useArtifact } from "@/hooks/use-artifact";
import { artifactDefinitions, ArtifactKind } from "./artifact";

// Expanded type to include all expected custom data payloads
export type DataStreamDelta = {
  type:
    | "text-delta"
    | "code-delta"
    | "sheet-delta"
    | "image-delta"
    | "html-delta"
    | "html"
    | "title"
    | "id"
    | "clear"
    | "finish"
    | "kind"
    // Deep Research specific types
    | "progress-init"
    | "depth-delta"
    | "activity-delta" // May contain steps
    | "activity" // Handle potential variation
    | "source-delta"
    | "warning" // Handle potential warning type
    | "complete" // Backend sends this on success
    | "error" // Backend sends this on error
    // Python Interpreter types (via backend endpoint)
    | "python-execution-start"
    | "python-stdout-delta"
    | "python-stderr-delta"
    | "python-execution-end"
    | "python-error";
  content: string | any;
};

export function DataStreamHandler({ id }: { id: string }) {
  const { data: dataStream } = useChat({ id });
  const { addActivity, addSource, initProgress, setDepth, updateProgress } =
    useDeepResearch();
  const { artifact, setArtifact, setMetadata } = useArtifact();
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

      // --- Artifact Handling (New Logic based on reference) ---

      // Check if the delta type is relevant for artifacts before proceeding
      const artifactDeltaTypes = [
        "text-delta",
        "code-delta",
        "sheet-delta",
        "image-delta",
        "title",
        "id",
        "clear",
        "finish",
        "kind",
      ];

      // Define Python specific delta types (execution via backend)
      const pythonDeltaTypes: DataStreamDelta["type"][] = [
        "python-execution-start",
        "python-stdout-delta",
        "python-stderr-delta",
        "python-execution-end",
        "python-error",
      ];

      // Handle Python Deltas (Example: Log them for now)
      if ((pythonDeltaTypes as string[]).includes(delta.type)) {
        console.log(
          `[DataStreamHandler] Received Python delta (${delta.type}):`,
          delta.content
        );
        // TODO: Implement specific UI updates based on python deltas
        // e.g., update a console display, show status indicators
        return; // Handled (by logging), exit early
      }

      if (!artifactDeltaTypes.includes(delta.type)) {
        // If it's not a known artifact delta or a deep research delta, log and skip
        console.warn("[DataStreamHandler] Unhandled delta type:", delta.type);
        return;
      }

      // Find the corresponding artifact definition
      const artifactDefinition = artifactDefinitions.find(
        (def) => def.kind === artifact.kind
      );

      // Call the artifact-specific stream handler if it exists
      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata,
        });
      }

      // Update common artifact properties (id, title, kind, clear, finish)
      setArtifact((draftArtifact) => {
        // Ensure draftArtifact exists, initialize if not
        const currentArtifact = draftArtifact || {
          ...initialArtifactData,
          status: "streaming",
        };

        switch (delta.type) {
          case "id":
            return {
              ...currentArtifact,
              documentId: delta.content as string,
              status: "streaming",
            };
          case "title":
            return {
              ...currentArtifact,
              title: delta.content as string,
              status: "streaming",
            };
          case "kind":
            // Ensure kind is updated correctly based on content
            const newKind = delta.content as ArtifactKind;
            // Only update if the kind is actually different
            if (currentArtifact.kind !== newKind) {
              console.log(
                `[DataStreamHandler] Updating artifact kind to: ${newKind}`
              );
              return {
                ...currentArtifact,
                kind: newKind,
                // Reset content/metadata if kind changes? Depends on desired behavior.
                // content: '', // Example: reset content
                status: "streaming",
              };
            }
            return currentArtifact; // No change if kind is the same

          case "clear":
            return {
              ...currentArtifact,
              content: "",
              status: "streaming",
            };
          case "finish":
            return {
              ...currentArtifact,
              status: "idle",
            };
          default:
            // Ensure we don't warn about handled python deltas here
            if (
              artifactDeltaTypes.includes(delta.type) &&
              !(pythonDeltaTypes as string[]).includes(delta.type)
            ) {
              console.warn(
                `[DataStreamHandler] Artifact delta type '${delta.type}' reached default switch case. Was it handled by onStreamPart?`
              );
            }
            return currentArtifact;
        }
      });
    });
  }, [
    dataStream,
    addActivity,
    addSource,
    initProgress,
    setDepth,
    updateProgress,
    artifact,
    setArtifact,
    setMetadata,
  ]);

  return null;
}
