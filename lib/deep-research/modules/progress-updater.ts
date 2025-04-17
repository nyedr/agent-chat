import { DataStreamWriter } from "ai";
import type { ResearchLogEntry } from "../types";

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

    this.dataStream.writeData({
      type: "progress-init",
      content: {
        maxDepth: state.maxDepth,
        totalSteps: initialTotalSteps,
      },
    });
  }

  /** Updates progress through the data stream */
  updateProgress(
    state: {
      currentDepth: number;
      maxDepth: number;
      completedSteps: number;
      totalSteps: number;
    },
    type: string,
    message: string
  ): void {
    if (!this.dataStream) {
      return;
    }

    const payload = {
      type,
      content: {
        message,
        current: state.currentDepth,
        max: state.maxDepth,
        completedSteps: state.completedSteps,
        totalSteps:
          type === "complete" ? state.completedSteps : state.totalSteps,
        timestamp: new Date().toISOString(),
      },
    };

    if (
      type === "depth-delta" ||
      type === "activity-delta" ||
      type === "warning" ||
      type === "error" ||
      type === "complete"
    ) {
      console.log(
        `[ProgressUpdater] Sending Progress (${type}):`,
        JSON.stringify(payload)
      );
    }

    this.dataStream.writeData(payload);
  }
}
