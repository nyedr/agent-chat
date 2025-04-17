"use client";

import {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useCallback,
} from "react";
import { DeepResearchToolResult } from "./deep-research/adapter";

interface ActivityItem {
  type:
    | "plan"
    | "search"
    | "scrape"
    | "vectorize"
    | "analyze"
    | "reasoning"
    | "synthesis"
    | "thought";
  status: "pending" | "complete" | "error" | "warning";
  message: string;
  timestamp: string;
  depth?: number;
}

interface SourceItem {
  url: string;
  title: string;
  relevance: number;
}

interface DeepResearchState {
  isActive: boolean;
  activity: ActivityItem[];
  sources: SourceItem[];
  currentDepth: number;
  maxDepth: number;
  completedSteps: number;
  totalExpectedSteps: number;
  isResearchInfoOpen: boolean;
}

type DeepResearchAction =
  | { type: "TOGGLE_ACTIVE" }
  | { type: "SET_ACTIVE"; payload: boolean }
  | {
      type: "ADD_ACTIVITY";
      payload: ActivityItem & { completedSteps?: number; totalSteps?: number };
    }
  | { type: "ADD_SOURCE"; payload: SourceItem }
  | { type: "SET_DEPTH"; payload: { current: number; max: number } }
  | { type: "INIT_PROGRESS"; payload: { maxDepth: number; totalSteps: number } }
  | { type: "UPDATE_PROGRESS"; payload: { completed: number; total: number } }
  | { type: "CLEAR_STATE" }
  | { type: "TOGGLE_INFO"; payload?: boolean }
  | { type: "SET_STATE_FROM_RESULT"; payload: DeepResearchToolResult["data"] };

interface DeepResearchContextType {
  state: DeepResearchState;
  toggleActive: () => void;
  setActive: (active: boolean) => void;
  addActivity: (
    activity: ActivityItem & { completedSteps?: number; totalSteps?: number }
  ) => void;
  addSource: (source: SourceItem) => void;
  setDepth: (current: number, max: number) => void;
  initProgress: (maxDepth: number, totalSteps: number) => void;
  updateProgress: (completed: number, total: number) => void;
  clearState: () => void;
  setIsResearchInfoOpen: (open?: boolean) => void;
  setStateFromResult: (resultData: DeepResearchToolResult["data"]) => void;
}

const initialState: DeepResearchState = {
  isActive: true,
  activity: [],
  sources: [],
  currentDepth: 0,
  maxDepth: 7,
  completedSteps: 0,
  totalExpectedSteps: 0,
  isResearchInfoOpen: false,
};

function deepResearchReducer(
  state: DeepResearchState,
  action: DeepResearchAction
): DeepResearchState {
  switch (action.type) {
    case "TOGGLE_ACTIVE":
      return {
        ...state,
        isActive: !state.isActive,
        ...(state.isActive && {
          activity: [],
          sources: [],
          currentDepth: 0,
          completedSteps: 0,
          totalExpectedSteps: 0,
        }),
      };
    case "SET_ACTIVE":
      return {
        ...state,
        isActive: action.payload,
        ...(action.payload === false && {
          activity: [],
          sources: [],
          currentDepth: 0,
          completedSteps: 0,
          totalExpectedSteps: 0,
        }),
      };
    case "ADD_ACTIVITY":
      // --- Prevent adding duplicate log entry during streaming ---
      const lastActivity = state.activity[state.activity.length - 1];
      if (
        lastActivity &&
        lastActivity.message === action.payload.message &&
        lastActivity.timestamp === action.payload.timestamp
      ) {
        // Skip adding if it looks like an exact duplicate of the last one
        return state;
      }
      // --- End duplicate check ---
      return {
        ...state,
        activity: [...state.activity, action.payload],
        completedSteps:
          action.payload.completedSteps ??
          (action.payload.status === "complete"
            ? state.completedSteps + 1
            : state.completedSteps),
        totalExpectedSteps:
          action.payload.totalSteps ?? state.totalExpectedSteps,
      };
    case "ADD_SOURCE":
      return {
        ...state,
        sources: [...state.sources, action.payload],
      };
    case "SET_DEPTH":
      console.log(
        "[Reducer] Handling SET_DEPTH. Current state depth:",
        state.currentDepth,
        "Payload:",
        action.payload
      );
      if (
        state.currentDepth === action.payload.current &&
        state.maxDepth === action.payload.max
      ) {
        return state;
      }
      return {
        ...state,
        currentDepth: action.payload.current,
        maxDepth: action.payload.max,
      };
    case "INIT_PROGRESS":
      return {
        ...state,
        maxDepth: action.payload.maxDepth,
        totalExpectedSteps: action.payload.totalSteps,
        completedSteps: 0,
        currentDepth: 0,
      };
    case "UPDATE_PROGRESS":
      return {
        ...state,
        completedSteps: action.payload.completed,
        totalExpectedSteps: action.payload.total,
      };
    case "CLEAR_STATE":
      return {
        ...initialState,
        activity: [],
        sources: [],
        currentDepth: 0,
        completedSteps: 0,
        totalExpectedSteps: 0,
      };
    case "TOGGLE_INFO":
      return {
        ...state,
        isResearchInfoOpen: action.payload ?? !state.isResearchInfoOpen,
      };
    case "SET_STATE_FROM_RESULT":
      const result = action.payload;

      // Directly use the logs from the result payload.
      // Assumes logs exist and match ActivityItem structure.
      const resultActivity: ActivityItem[] = (result.logs ||
        []) as ActivityItem[];

      // Map sources record to SourceItem array
      const resultSources: SourceItem[] = Object.entries(
        result.sources || {}
      ).map(([url, title]) => ({
        url,
        title,
        relevance: 0.5, // Assign default relevance
      }));

      return {
        ...state,
        activity: resultActivity, // Use the logs directly
        sources: resultSources,
        currentDepth: result.metrics?.iterationsCompleted ?? 0, // Use metrics or default
        maxDepth: state.maxDepth, // Keep original max depth setting
        completedSteps: result.completedSteps,
        totalExpectedSteps: result.totalSteps,
        isActive: false, // Set inactive as research is finished
        isResearchInfoOpen: true, // Ensure info panel is open
      };
    default:
      return state;
  }
}

const DeepResearchContext = createContext<DeepResearchContextType | undefined>(
  undefined
);

export function DeepResearchProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(deepResearchReducer, initialState);

  const toggleActive = useCallback(() => {
    dispatch({ type: "TOGGLE_ACTIVE" });
  }, []);

  const setIsResearchInfoOpen = useCallback(
    (open?: boolean) => {
      dispatch({
        type: "TOGGLE_INFO",
        payload: open ?? !state.isResearchInfoOpen,
      });
    },
    [state.isResearchInfoOpen]
  );

  const setActive = useCallback((active: boolean) => {
    dispatch({ type: "SET_ACTIVE", payload: active });
  }, []);

  const addActivity = useCallback(
    (
      activity: ActivityItem & { completedSteps?: number; totalSteps?: number }
    ) => {
      dispatch({ type: "ADD_ACTIVITY", payload: activity });
    },
    []
  );

  const addSource = useCallback((source: SourceItem) => {
    dispatch({ type: "ADD_SOURCE", payload: source });
  }, []);

  const setDepth = useCallback((current: number, max: number) => {
    console.log("[DeepResearchContext] Dispatching SET_DEPTH:", {
      current,
      max,
    });
    dispatch({ type: "SET_DEPTH", payload: { current, max } });
  }, []);

  const initProgress = useCallback((maxDepth: number, totalSteps: number) => {
    dispatch({ type: "INIT_PROGRESS", payload: { maxDepth, totalSteps } });
  }, []);

  const updateProgress = useCallback((completed: number, total: number) => {
    dispatch({ type: "UPDATE_PROGRESS", payload: { completed, total } });
  }, []);

  const clearState = useCallback(() => {
    dispatch({ type: "CLEAR_STATE" });
  }, []);

  const setStateFromResult = useCallback(
    (resultData: DeepResearchToolResult["data"]) => {
      dispatch({ type: "SET_STATE_FROM_RESULT", payload: resultData });
    },
    []
  );

  return (
    <DeepResearchContext.Provider
      value={{
        state,
        toggleActive,
        setActive,
        addActivity,
        addSource,
        setDepth,
        initProgress,
        updateProgress,
        clearState,
        setIsResearchInfoOpen,
        setStateFromResult,
      }}
    >
      {children}
    </DeepResearchContext.Provider>
  );
}

export function useDeepResearch() {
  const context = useContext(DeepResearchContext);
  if (context === undefined) {
    throw new Error(
      "useDeepResearch must be used within a DeepResearchProvider"
    );
  }
  return context;
}
