"use client";

import { memo } from "react";
import { CodeBlock } from "@/components/code-block";
import { CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import fastDeepEqual from "fast-deep-equal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface PythonInterpreterProps {
  args: { code: string };
  result?: {
    executionId: string;
    status: "success" | "error";
    stdout?: string;
    stderr?: string;
    error?: string;
    plot_url?: string;
  };
  isLoading: boolean;
  state: string;
}

const PythonInterpreterDisplay = ({
  args,
  result,
  isLoading,
  state,
}: PythonInterpreterProps) => {
  const isRunning = state !== "result" || isLoading;
  const finalStatus = result?.status;
  const executionSetupError = result?.error;
  const runtimeError = result?.stderr;
  const displayStatus = isRunning
    ? "running"
    : executionSetupError || finalStatus === "error"
    ? "error"
    : "success";

  // Prepare the result text to display
  let resultText = "";
  if (!isRunning) {
    if (executionSetupError) {
      resultText = executionSetupError;
    } else if (result?.stdout) {
      resultText = result.stdout;
    }
    if (runtimeError && !executionSetupError) {
      resultText = resultText
        ? `${resultText}\n\n${runtimeError}`
        : runtimeError;
    }
  }

  return (
    <div className="w-full max-w-3xl rounded-xl border border-border shadow-sm overflow-hidden font-['Noto_Sans']">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="interpreter" className="border-0">
          <AccordionTrigger className="px-4 py-3 text-muted-foreground hover:bg-muted transition-colors hover:no-underline">
            <div className="flex items-center gap-2">
              {displayStatus === "running" && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              {displayStatus === "success" && (
                <CheckCircle className="size-4 text-primary" />
              )}
              {displayStatus === "error" && (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              <span className="text-sm font-medium">
                {isRunning
                  ? "Running Python"
                  : displayStatus === "success"
                  ? "Execution Complete"
                  : "Execution Failed"}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            <CodeBlock useMinimal={true} language="python" result={resultText}>
              {args.code}
            </CodeBlock>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export const PythonInterpreter = memo(
  PythonInterpreterDisplay,
  (prevProps, nextProps) => fastDeepEqual(prevProps, nextProps)
);
