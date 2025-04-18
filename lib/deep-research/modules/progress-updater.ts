import { DataStreamWriter } from "ai";
import type { ResearchLogEntry, ResearchState } from "../types";
import { randomUUID } from "crypto";

// Define the specific event types allowed for progress updates
export type ProgressEventType =
  | "activity" // A significant task started/is in progress
  | "activity-delta" // A sub-task completed or significant change occurred
  | "depth-delta" // Starting a new research depth level
  | "warning" // A non-critical issue occurred
  | "error" // A critical error occurred
  | "complete"; // The entire research process finished

export class ProgressUpdater {
  private dataStream: DataStreamWriter | null;
  public logs: ResearchLogEntry[] = [];

  constructor(dataStream: DataStreamWriter | null) {
    this.dataStream = dataStream;
    this.logs = [];
  }

  /** Clears the internal logs */
  clearLogs(): void {
    this.logs = [];
  }

  /** Adds a log entry internally and optionally logs to console */
  addLogEntry(
    type: ResearchLogEntry["type"],
    status: ResearchLogEntry["status"],
    message: string,
    depth?: number
  ): void {
    const entry: ResearchLogEntry = {
      type,
      status,
      message,
      timestamp: new Date().toISOString(),
      depth,
    };
    this.logs.push(entry);
    console.log(
      `[Log - ${type}/${status}${depth ? ` D${depth}` : ""}] ${message}`
    );
  }

  /** Sends the initial progress update */
  updateProgressInit(
    state: {
      maxDepth: number;
      reportPlan: any;
      totalSteps: number;
      currentDepth: number;
    },
    baseStepsPerIteration: number,
    planningStep: number,
    finalReportSteps: number
  ): void {
    if (!this.dataStream) return;

    const plannedSections = state.reportPlan?.report_outline?.length || 1;
    const initialTotalSteps =
      planningStep + plannedSections * baseStepsPerIteration + finalReportSteps;

    state.totalSteps = initialTotalSteps;

    this.addLogEntry(
      "thought",
      "pending",
      `Initialized progress. Estimated total steps: ${initialTotalSteps}`,
      state.currentDepth
    );

    const eventId = randomUUID();

    this.dataStream.writeData({
      type: "progress-init",
      id: eventId,
      content: {
        maxDepth: state.maxDepth,
        totalSteps: initialTotalSteps,
      },
    });
  }

  /** Updates progress through the data stream */
  updateProgress(
    state: ResearchState,
    type: ProgressEventType,
    message: string
  ): void {
    if (!this.dataStream) return;

    const eventId = randomUUID();

    // Calculate total based on completed + outstanding (queue length) + 1 for final report
    const outstanding = state.researchQueue.length;
    const done = state.completedSteps;
    // Use simple done + outstanding + 1 (final report) for total estimate
    const dynamicTotalSteps = done + outstanding + 1;

    const payload = {
      type,
      id: eventId,
      content: {
        message,
        current: state.currentDepth,
        max: state.maxDepth,
        completedSteps: state.completedSteps,
        totalSteps:
          type === "complete" ? state.completedSteps : dynamicTotalSteps,
        timestamp: new Date().toISOString(),
      },
    };

    console.log(
      `[ProgressUpdater] Sending Progress (${type}):`,
      JSON.stringify(payload)
    );

    this.dataStream.writeData(payload);
  }
}
