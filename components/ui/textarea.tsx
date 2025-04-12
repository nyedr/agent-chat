import * as React from "react";

import { cn, linkRegex } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export type AutosizeTextAreaRef = {
  textArea: HTMLTextAreaElement;
  maxHeight: number;
  minHeight: number;
};

type AutosizeTextAreaProps = {
  maxHeight?: number;
  minHeight?: number;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const AutosizeTextarea = React.forwardRef<
  AutosizeTextAreaRef,
  AutosizeTextAreaProps
>(
  (
    {
      maxHeight = Number.MAX_SAFE_INTEGER,
      minHeight = 52,
      className,
      onChange,
      value,
      ...props
    }: AutosizeTextAreaProps,
    ref: React.Ref<AutosizeTextAreaRef>
  ) => {
    const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [triggerAutoSize, setTriggerAutoSize] = React.useState("");

    React.useEffect(() => {
      setTriggerAutoSize(value as string);
    }, [props?.defaultValue, value]);

    return (
      <textarea
        {...props}
        value={value}
        ref={textAreaRef}
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        onChange={(e) => {
          setTriggerAutoSize(e.target.value);
          onChange?.(e);
        }}
      />
    );
  }
);
AutosizeTextarea.displayName = "AutosizeTextarea";

interface HighlightableTextareaProps extends React.ComponentProps<"textarea"> {
  highlightClassName?: string;
  maxHeight?: number;
  minHeight?: number;
  matchRegex?: RegExp;
}

const HighlightableTextarea = React.forwardRef<
  HTMLTextAreaElement,
  HighlightableTextareaProps
>(
  (
    {
      className,
      value,
      onChange,
      onScroll,
      highlightClassName = "text-blue-500",
      minHeight = 24,
      maxHeight = Number.MAX_SAFE_INTEGER,
      matchRegex = linkRegex,
      ...props
    },
    ref
  ) => {
    const [scrollState, setScrollState] = React.useState({
      scrollTop: 0,
      scrollLeft: 0,
    });
    const highlightRef = React.useRef<HTMLDivElement>(null);
    const localTextareaRef = React.useRef<HTMLTextAreaElement>(null);
    const [init, setInit] = React.useState(true);

    React.useImperativeHandle(ref, () => localTextareaRef.current!, []);

    React.useEffect(() => {
      const textAreaRef = localTextareaRef.current;
      const offsetBorder = 2;

      if (textAreaRef) {
        if (init) {
          textAreaRef.style.minHeight = `${minHeight}px`;
          if (maxHeight !== Number.MAX_SAFE_INTEGER && maxHeight > minHeight) {
            if (
              !textAreaRef.style.maxHeight ||
              parseFloat(textAreaRef.style.maxHeight) > maxHeight
            ) {
              textAreaRef.style.maxHeight = `${maxHeight}px`;
            }
          }
          setInit(false);
        }

        const computedStyle = window.getComputedStyle(textAreaRef);
        const cssMaxHeight = parseFloat(computedStyle.maxHeight);
        const effectiveMaxHeight = Math.min(
          maxHeight,
          isNaN(cssMaxHeight) ? Number.MAX_SAFE_INTEGER : cssMaxHeight
        );

        const currentScrollTop = textAreaRef.scrollTop;
        textAreaRef.style.height = "0px";
        const scrollHeight = textAreaRef.scrollHeight;

        let newHeight = scrollHeight + offsetBorder;

        newHeight = Math.max(minHeight, newHeight);
        newHeight = Math.min(effectiveMaxHeight, newHeight);

        textAreaRef.style.height = `${newHeight}px`;
        textAreaRef.scrollTop = currentScrollTop;
      }
    }, [value, minHeight, maxHeight, init]);

    const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
      const { scrollTop, scrollLeft } = event.currentTarget;
      setScrollState({ scrollTop, scrollLeft });
      if (onScroll) {
        onScroll(event);
      }
    };

    React.useEffect(() => {
      if (highlightRef.current) {
        highlightRef.current.scrollTop = scrollState.scrollTop;
        highlightRef.current.scrollLeft = scrollState.scrollLeft;
      }
    }, [scrollState]);

    const renderHighlightedText = React.useMemo(() => {
      const text = String(value || "");
      if (!text) return null;

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;

      matchRegex.lastIndex = 0;
      let match;

      while ((match = matchRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }
        parts.push(
          <span key={`link-${match.index}`} className={highlightClassName}>
            {match[0]}
          </span>
        );
        lastIndex = matchRegex.lastIndex;
      }

      if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
      }

      return parts;
    }, [value, highlightClassName]);

    const defaultTextareaBaseStyles =
      "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

    const highlightDivBaseStyles =
      "min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

    const overlayStyles =
      "whitespace-pre-wrap break-words font-inherit tracking-inherit leading-inherit p-0 m-0 border-0 text-inherit";

    return (
      <div className="relative w-full">
        <div
          ref={highlightRef}
          className={cn(
            highlightDivBaseStyles,
            overlayStyles,
            className,
            "absolute inset-0 z-0",
            "pointer-events-none"
          )}
          aria-hidden="true"
        >
          {renderHighlightedText}
        </div>
        <textarea
          ref={localTextareaRef}
          className={cn(
            defaultTextareaBaseStyles,
            overlayStyles,
            className,
            "relative z-10",
            "bg-transparent",
            "text-transparent",
            "caret-black dark:caret-white"
          )}
          value={value}
          onChange={onChange}
          onScroll={handleScroll}
          {...props}
        />
      </div>
    );
  }
);
HighlightableTextarea.displayName = "HighlightableTextarea";

export { Textarea, HighlightableTextarea };
