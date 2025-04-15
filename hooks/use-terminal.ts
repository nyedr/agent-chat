"use client";

import { type TerminalRef } from "@/components/terminal";
import { createScopedLogger } from "@/lib/terminal/log";
import { Terminal as XTerm } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";

const logger = createScopedLogger("useTerminal");

interface UseTerminalOptions {
  // Callback when terminal receives data (user input)
  // This would likely send data over WebSocket if interactive
  onData?: (data: string) => void;
  // Callback when terminal receives data (shell output)
  // This is likely NOT needed here anymore, as output comes via DataStreamHandler
  // onOutput?: (data: string) => void;
  // Callback when terminal is resized
  // This would likely send resize info over WebSocket if interactive
  onResize?: (cols: number, rows: number) => void;
}

export function useTerminal(options: UseTerminalOptions = {}) {
  const { onData, onResize } = options;
  const terminalRef = useRef<TerminalRef>(null); // For Terminal component
  const terminalInstanceRef = useRef<XTerm | null>(null); // For XTerm instance
  const onDataListenerRef = useRef<IDisposable | null>(null);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      logger.info("Disposing terminal listeners due to hook unmount.");
      onDataListenerRef.current?.dispose();
      onDataListenerRef.current = null;
      // Terminal instance itself is disposed by Terminal component's effect
    };
  }, []);

  const handleTerminalReady = useCallback(
    (terminal: XTerm) => {
      if (terminalInstanceRef.current) {
        logger.warn("Terminal already initialized.");
        return;
      }
      logger.info("Terminal instance received and ready.");
      terminalInstanceRef.current = terminal;

      // Dispose previous listener if exists
      onDataListenerRef.current?.dispose();

      // Setup listener for user input (to be sent via WebSocket if interactive)
      if (onData) {
        onDataListenerRef.current = terminal.onData((data) => {
          logger.debug("Terminal data received (from user input):", data);
          onData(data); // Forward data (e.g., to WebSocket sender)
        });
      } else {
        // If no onData handler, maybe just log locally or do nothing
        onDataListenerRef.current = terminal.onData((data) => {
          logger.debug("Terminal data received (no handler):", data);
          // Optionally provide basic echo for local testing, but not real shell behavior
          // if (data === '\r') terminal.write('\r\n'); else if (data === '\x7f') terminal.write('\b \b'); else terminal.write(data);
        });
      }

      // Handle terminal disposal
      terminal.dispose();
      logger.info("Terminal instance disposed by component.");
      terminalInstanceRef.current = null;
      onDataListenerRef.current?.dispose(); // Ensure listener is cleaned up
      onDataListenerRef.current = null;
    },
    [onData] // Recreate if onData handler changes
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      logger.debug("Terminal resized event:", { cols, rows });
      // Removed: shellProcessRef.current.resize

      // Forward resize event (e.g., to WebSocket sender if interactive)
      if (onResize) {
        onResize(cols, rows);
      }
    },
    [onResize] // Recreate if onResize handler changes
  );

  // Function to write data programmatically TO THE VISIBLE TERMINAL
  // (Likely used by WebSocket receiver if interactive)
  const writeToTerminal = useCallback((data: string) => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.write(data);
    } else {
      logger.warn("Cannot write to terminal: Instance not ready.");
    }
  }, []); // No dependencies needed as it uses refs

  return {
    terminalRef, // Ref to pass to <Terminal component={ref}>
    handleTerminalReady, // Callback for onTerminalReady prop
    handleTerminalResize, // Callback for onTerminalResize prop
    writeToTerminal, // Function to write *to* the visible terminal display
    // Removed: isShellReady
  };
}
