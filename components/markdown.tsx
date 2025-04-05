import { LinkPreview } from "./ui/link-preview";
import { useEffect, useRef, useState } from "react";
import { cn, removeInlineTicks } from "@/lib/utils";
import Markdown, { Options } from "react-markdown";
import { Image } from "@lobehub/ui";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { CodeBlock } from "./code-block";

export default function ChatMarkdown({
  content,
  isUserMessage = false,
}: {
  content: string;
  isUserMessage?: boolean;
}) {
  // Create a ref to track the rendered content
  const contentRef = useRef<HTMLDivElement>(null);
  const [isContentTruncated, setIsContentTruncated] = useState(false);

  // Check if the content is being truncated
  useEffect(() => {
    if (contentRef.current) {
      const element = contentRef.current;
      // Check if text is being clipped (scrollWidth > clientWidth indicates overflow)
      const isTruncated =
        element.scrollWidth > element.clientWidth ||
        element.scrollHeight > element.clientHeight;

      if (isTruncated !== isContentTruncated) {
        setIsContentTruncated(isTruncated);
      }
    }
  }, [isContentTruncated]);

  // Define comprehensive markdown options to ensure proper rendering
  const markdownComponentProps: Options = {
    rehypePlugins: [rehypeRaw],
    remarkPlugins: [remarkGfm],
    className: "w-full overflow-hidden break-words text-base leading-7",
    components: {
      code: ({ node, inline, className, children, ...props }: any) => {
        const match = /language-(\w+)/.exec(className || "");

        return !inline && match ? (
          <CodeBlock language={match[1]}>
            {String(children).replace(/\n$/, "")}
          </CodeBlock>
        ) : (
          <code className="inline-code not-prose" {...props}>
            {removeInlineTicks(String(children))}
          </code>
        );
      },
      a: ({ href, children, className }: any) => (
        <LinkPreview className={className} url={href}>
          {children}
        </LinkPreview>
      ),
      h1: ({ children }: any) => (
        <h1
          style={{
            fontSize: "2em",
            fontWeight: "700",
            lineHeight: "40px",
            marginBottom: "2rem",
          }}
        >
          {children}
        </h1>
      ),
      h2: ({ children }: any) => (
        <h2
          style={{
            fontSize: "1.5em",
            fontWeight: "600",
            lineHeight: "32px",
            marginTop: "2rem",
            marginBottom: "1rem",
          }}
        >
          {children}
        </h2>
      ),
      h3: ({ children }: any) => (
        <h3
          style={{
            fontSize: "1.25em",
            fontWeight: "600",
            lineHeight: "32px",
            marginTop: "1rem",
            marginBottom: "0.5rem",
          }}
        >
          {children}
        </h3>
      ),
      h4: ({ children }: any) => (
        <h4
          style={{
            fontSize: "1em",
            fontWeight: "600",
            lineHeight: "24px",
            marginTop: "1rem",
            marginBottom: "0.5rem",
          }}
        >
          {children}
        </h4>
      ),
      h5: ({ children }: any) => (
        <h5
          style={{
            fontSize: "1em",
            fontWeight: "600",
            lineHeight: "28px",
          }}
        >
          {children}
        </h5>
      ),
      p: ({ children }: any) => (
        <p
          className={cn(
            "whitespace-normal break-words",
            isUserMessage && "leading-6",
            !isUserMessage && "my-2 leading-7"
          )}
        >
          {children}
        </p>
      ),
      ul: ({ children }: any) => (
        <ul className="list-disc pl-6 my-3 space-y-1.5">{children}</ul>
      ),
      ol: ({ children }: any) => (
        <ol className="list-decimal pl-6 my-3 space-y-1.5">{children}</ol>
      ),
      li: ({ children }: any) => <li className="my-1 pl-1.5">{children}</li>,
      blockquote: ({ children }: any) => (
        <blockquote className="border-l-4 border-muted pl-4 italic my-3">
          {children}
        </blockquote>
      ),
      strong: ({ children }: any) => (
        <strong className="font-semibold">{children}</strong>
      ),
      img: ({ src, alt }: any) => (
        <Image
          src={src}
          alt={alt}
          borderless={true}
          wrapperClassName="w-full max-w-3xl box-shadow-none"
          objectFit="cover"
          className="my-0"
        />
      ),
    },
  };

  // Create the markdown component with proper styling
  return <Markdown {...markdownComponentProps}>{content}</Markdown>;
}
