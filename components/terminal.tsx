"use client";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import type { ITerminalOptions } from "@xterm/xterm";
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { createScopedLogger } from "../lib/terminal/log";
import { getTerminalTheme, type Theme } from "../lib/terminal/theme";

const logger = createScopedLogger("Terminal");

export interface TerminalRef {
  reloadStyles: () => void;
}

export interface TerminalProps {
  className?: string;
  theme: Theme;
  readonly?: boolean;
  onTerminalReady?: (terminal: XTerm) => void;
  onTerminalResize?: (cols: number, rows: number) => void;
}

export const Terminal = memo(
  forwardRef<TerminalRef, TerminalProps>(
    (
      { className, theme, readonly, onTerminalReady, onTerminalResize },
      ref
    ) => {
      const terminalElementRef = useRef<HTMLDivElement>(null);
      const terminalRef = useRef<XTerm>();

      useEffect(() => {
        if (!terminalElementRef.current) {
          logger.error("Terminal element ref is not available.");
          return;
        }

        const element = terminalElementRef.current;

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        const currentTheme = getTerminalTheme(
          theme,
          readonly ? { cursor: "#00000000" } : {}
        );
        const terminalOptions: ITerminalOptions = {
          cursorBlink: true,
          convertEol: true,
          disableStdin: !!readonly,
          theme: currentTheme,
          fontSize: 12,
          fontFamily: "Menlo, courier-new, courier, monospace",
        };

        let terminal: XTerm | null = null;
        try {
          terminal = new XTerm(terminalOptions);
          terminalRef.current = terminal;

          terminal.loadAddon(fitAddon);
          terminal.loadAddon(webLinksAddon);
          terminal.open(element);
        } catch (e) {
          logger.error("Failed to initialize XTerm:", e);
          return;
        }

        const resizeObserver = new ResizeObserver(() => {
          if (!terminal) return;
          try {
            fitAddon.fit();
            onTerminalResize?.(terminal.cols, terminal.rows);
          } catch (e) {
            if (!(e instanceof Error && e.message.includes("ResizeObserver"))) {
              logger.error("Error fitting terminal:", e);
            }
          }
        });

        try {
          resizeObserver.observe(element);
        } catch (e) {
          logger.error("Failed to observe terminal element:", e);
        }

        logger.info("Terminal attached");
        onTerminalReady?.(terminal);

        const fitTimeout = setTimeout(() => {
          if (!terminal) return;
          try {
            fitAddon.fit();
            onTerminalResize?.(terminal.cols, terminal.rows);
          } catch (e) {
            logger.warn("Error during initial fit:", e);
          }
        }, 100);

        return () => {
          clearTimeout(fitTimeout);
          resizeObserver.disconnect();
          terminal?.dispose();
          terminalRef.current = undefined;
          logger.info("Terminal disposed");
        };
      }, [readonly, onTerminalReady, onTerminalResize, theme]);

      useEffect(() => {
        const terminal = terminalRef.current;
        if (!terminal) return;

        const newTheme = getTerminalTheme(
          theme,
          readonly ? { cursor: "#00000000" } : {}
        );
        if (
          JSON.stringify(terminal.options.theme) !== JSON.stringify(newTheme)
        ) {
          terminal.options.theme = newTheme;
        }
        if (terminal.options.disableStdin !== !!readonly) {
          terminal.options.disableStdin = !!readonly;
        }
      }, [theme, readonly]);

      useImperativeHandle(
        ref,
        () => ({
          reloadStyles: () => {
            const terminal = terminalRef.current;
            if (!terminal) return;
            terminal.options.theme = getTerminalTheme(
              theme,
              readonly ? { cursor: "#00000000" } : {}
            );
            logger.info("Terminal styles reloaded");
          },
        }),
        [theme, readonly]
      );

      return (
        <div
          className={className}
          ref={terminalElementRef}
          style={{ height: "50%", width: "50%" }}
        />
      );
    }
  )
);

Terminal.displayName = "Terminal";
