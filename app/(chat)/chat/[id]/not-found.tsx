import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-4">
      <div className="text-destructive text-lg font-medium">
        Chat session not found
      </div>
      <p className="text-muted-foreground text-sm">
        This chat session may have been deleted or never existed.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Start new chat</Link>
      </Button>
    </div>
  );
}
