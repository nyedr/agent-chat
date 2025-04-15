"use client";

import { Terminal, TerminalRef } from "@/components/terminal";
import { Terminal as XTerm } from "@xterm/xterm";
import { useTheme } from "next-themes";
import { useRef } from "react";

export default function TestPage() {
  const terminalRef = useRef<TerminalRef>(null);
  const { resolvedTheme } = useTheme();

  // Determine the theme, default to dark if needed
  const currentTheme =
    resolvedTheme === "light" || resolvedTheme === "dark"
      ? resolvedTheme
      : "dark";

  const handleTerminalReady = (terminalInstance: XTerm) => {
    console.log("Terminal is ready:", terminalInstance);
    // Removed onKey handler - Input should be sent to a backend process
    // Example: terminalInstance.onData(data => sendToBackend(data));

    // You can interact with the XTerm instance here if needed
    terminalInstance.write(
      "Welcome to the terminal! (Input handling requires backend connection)\r\n$ "
    );
  };

  const handleTerminalResize = (cols: number, rows: number) => {
    console.log("Terminal resized:", { cols, rows });
    // In a real app, you might send this to the backend PTY process
    // Example: sendResizeToBackend(cols, rows);
  };

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center p-4">
      <div className="size-3/4 overflow-hidden rounded border border-neutral-700">
        <Terminal
          ref={terminalRef}
          theme={currentTheme} // Use dynamic theme
          onTerminalReady={handleTerminalReady}
          onTerminalResize={handleTerminalResize} // Add resize handler
          readonly={false} // Keep it visually interactive
          className="size-full" // Ensure terminal fills its container
        />
      </div>
    </div>
  );
}
