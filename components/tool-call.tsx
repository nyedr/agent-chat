import { Loader2, CheckIcon, ChevronDown } from "lucide-react";
import { memo } from "react";
import { motion } from "framer-motion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { CodeBlock } from "./code-block";
import { cn } from "@/lib/utils";

interface DocumentToolCallProps {
  type: "complete" | "loading";
  args: Record<string, any>;
  result?: string | Record<string, any>;
  toolName: string;
}

function PureToolCall({
  type = "loading",
  args,
  toolName,
  result,
}: DocumentToolCallProps) {
  return (
    <Collapsible className="w-full max-w-[736px] my-4">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full border rounded-xl px-4 py-3 flex items-center justify-between gap-4 shadow",
            "bg-gradient-to-r from-background to-muted hover:from-muted hover:to-background transition-colors duration-300",
            "focus:outline-none focus:ring-2 focus:ring-primary/20",
            type === "complete" ? "border-primary/30" : "border-primary/50"
          )}
        >
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300 }}
              className={cn(
                "flex items-center justify-center rounded-full p-2",
                type === "complete"
                  ? "bg-primary/10 text-primary"
                  : "bg-primary/20 text-primary"
              )}
            >
              {type === "complete" ? (
                <CheckIcon className="size-4" />
              ) : (
                <Loader2 className="size-4 animate-spin" />
              )}
            </motion.div>
            <span className="font-semibold text-foreground">{toolName}</span>
          </div>
          <ChevronDown className="size-5 text-muted-foreground transition-transform duration-300 ease-in-out group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
        <div className="py-3 px-2 bg-card rounded-b-xl">
          {result != null ? (
            <CodeBlock className="shadow-sm" language="json">
              {typeof result === "string"
                ? JSON.stringify(JSON.parse(result), null, 2)
                : JSON.stringify(result, null, 2)}
            </CodeBlock>
          ) : (
            <CodeBlock className="shadow-sm" language="json">
              {JSON.stringify(args, null, 2)}
            </CodeBlock>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const ToolCall = memo(PureToolCall, (prevProps, nextProps) => {
  return prevProps.type === nextProps.type;
});
