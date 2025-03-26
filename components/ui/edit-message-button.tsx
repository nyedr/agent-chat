"use client";

import { Dispatch, forwardRef, SetStateAction } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";
import { PencilEditIcon } from "../icons";

export interface EditMessageButtonProps
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

  setMode: Dispatch<SetStateAction<"edit" | "view">>;
}

const EditMessageButton = forwardRef<HTMLButtonElement, EditMessageButtonProps>(
  (
    { content, asChild = false, className, onClick, setMode, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        className={cn("text-muted-foreground", className)}
        onClick={() => {
          setMode("edit");
        }}
        {...props}
      >
        <PencilEditIcon className="h-4 w-4" />
      </Comp>
    );
  }
);

EditMessageButton.displayName = "EditMessageButton";

export default EditMessageButton;
