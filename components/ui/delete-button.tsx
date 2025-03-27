"use client";

import { Button } from "@/components/ui/button";
import { Loader2, Trash } from "lucide-react";
import { useState, forwardRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

export interface DeleteButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  chatId: string;
  messageId: string;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  asChild?: boolean;
}

const DeleteButton = forwardRef<HTMLButtonElement, DeleteButtonProps>(
  (
    {
      chatId,
      messageId,
      onDelete,
      asChild = false,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async (e: React.MouseEvent<HTMLButtonElement>) => {
      setIsDeleting(true);

      try {
        await onDelete(e);
      } catch (error) {
        console.error("Failed to delete message:", error);
        toast.error("Failed to delete message. Please try again.");
      } finally {
        setIsDeleting(false);
      }
    };

    const baseClassName = cn(
      isDeleting
        ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
        : "text-muted-foreground hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 dark:hover:text-red-400",
      className
    );

    const icon = isDeleting ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Trash className="h-4 w-4" />
    );

    const Comp = asChild ? Slot : Button;

    return (
      <Comp
        ref={ref}
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={isDeleting}
        aria-label="Delete this message"
        className={baseClassName}
        {...props}
      >
        {icon}
      </Comp>
    );
  }
);

DeleteButton.displayName = "DeleteButton";

export default DeleteButton;
