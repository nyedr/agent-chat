"use client";

import { useMultimodalCopyToClipboard } from "@/hooks/use-multimodal-copy-to-clipboard";
import { Check, Copy } from "lucide-react";
import { useState, forwardRef } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

export interface CopyButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * @description The text content to be copied
   */
  content: string;
  /**
   * @description If true, the component will not render its own DOM element
   * but instead merge its props with its child
   */
  asChild?: boolean;
}

const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(
  ({ content, asChild = false, className, onClick, ...props }, ref) => {
    const { copyTextToClipboard } = useMultimodalCopyToClipboard();
    const [copied, setCopied] = useState(false);
    const Icon = copied ? Check : Copy;

    const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
      // Call the original onClick if provided
      onClick?.(e);

      // Copy text to clipboard
      await copyTextToClipboard(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        className={cn("text-muted-foreground", className)}
        onClick={handleCopy}
        {...props}
      >
        <Icon className="h-4 w-4" />
      </Comp>
    );
  }
);

CopyButton.displayName = "CopyButton";

export default CopyButton;
