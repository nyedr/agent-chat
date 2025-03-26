import { cn } from "@/lib/utils";

interface AnimatedGradientTextProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
}

export default function AnimatedGradientText({
  text,
  className,
  ...props
}: AnimatedGradientTextProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex animate-text-gradient bg-gradient-to-r from-[#ACACAC] via-[#363636] to-[#ACACAC] bg-[200%_auto] text-3xl text-center text-transparent font-medium bg-clip-text",
        className
      )}
    >
      {text}
    </span>
  );
}
