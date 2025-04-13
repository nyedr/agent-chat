import { memo } from "react";
import { CodeBlock } from "../code-block";
import { CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface DocumentToolCallProps {
  type: "success" | "loading" | "error";
  args: Record<string, any>;
  result?: string | Record<string, any>;
  toolName: string;
  customMessage?: string;
  icon?: React.ReactNode;
}

function PureToolCall({
  type = "loading",
  args,
  toolName,
  result,
  customMessage,
  icon,
}: DocumentToolCallProps) {
  const displayStatus = type;
  const isRunning = type === "loading";

  return (
    <div className="w-full max-w-3xl rounded-xl border border-border shadow-sm overflow-hidden font-['Noto_Sans']">
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="interpreter" className="border-0">
          <AccordionTrigger className="px-4 py-3 text-muted-foreground hover:bg-muted transition-colors hover:no-underline">
            <div className="flex items-center gap-2">
              {icon || (
                <>
                  {displayStatus === "loading" && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {displayStatus === "success" && (
                    <CheckCircle className="size-4 text-primary" />
                  )}
                  {displayStatus === "error" && (
                    <AlertTriangle className="size-4 text-destructive" />
                  )}
                </>
              )}
              <span className="text-sm font-medium">
                {customMessage ||
                  (isRunning
                    ? `Calling Tool: ${toolName}`
                    : displayStatus === "success"
                    ? `Tool Called: ${toolName}`
                    : "Tool Call Failed")}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="p-0">
            {result != null ? (
              <CodeBlock
                useMinimal={true}
                className="shadow-sm"
                language="json"
              >
                {typeof result === "string"
                  ? JSON.stringify(JSON.parse(result), null, 2)
                  : JSON.stringify(result, null, 2)}
              </CodeBlock>
            ) : (
              <CodeBlock
                useMinimal={true}
                className="shadow-sm"
                language="json"
              >
                {JSON.stringify(args, null, 2)}
              </CodeBlock>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export const ToolCall = memo(PureToolCall, (prevProps, nextProps) => {
  return prevProps.type === nextProps.type;
});
