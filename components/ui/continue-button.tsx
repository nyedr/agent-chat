"use client";

import { Button } from "@/components/ui/button";
import { SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { forwardRef, useState } from "react";

export interface ContinueButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  chatId: string;
  messageId: string;
  continue: () => void;
  scrollToMessage?: (messageId: string) => void;
  asChild?: boolean;
}

const ContinueButton = forwardRef<HTMLButtonElement, ContinueButtonProps>(
  (
    {
      continue: onContinue,
      chatId,
      messageId,
      scrollToMessage,
      asChild = false,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleContinue = async (e: React.MouseEvent<HTMLButtonElement>) => {
      // Call the original onClick if provided
      onClick?.(e);

      try {
        setIsProcessing(true);
        onContinue();

        // If scrollToMessage is provided, scroll to this message
        if (scrollToMessage && messageId) {
          setTimeout(() => {
            scrollToMessage(messageId);
          }, 100);
        }
      } catch (error) {
        console.error("Error continuing message:", error);
      } finally {
        setIsProcessing(false);
      }
    };

    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label="Continue"
        onClick={handleContinue}
        className={cn(
          "text-muted-foreground",
          { "opacity-50 cursor-not-allowed": isProcessing },
          className
        )}
        disabled={isProcessing}
        {...props}
      >
        <SkipForward className="h-4 w-4" />
      </Comp>
    );
  }
);

ContinueButton.displayName = "ContinueButton";

export default ContinueButton;
