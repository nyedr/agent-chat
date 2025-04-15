"use client";

import type { ITheme } from "@xterm/xterm";

export type Theme = "dark" | "light";

// Extracted colors from the provided CSS variables
const lightThemeColors: ITheme = {
  background: "#ffffff",
  foreground: "#333333",
  selectionBackground: "#00000040",
  cursor: "#333333",
  cursorAccent: "#ffffff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#686868",
  brightRed: "#cd3131",
  brightGreen: "#00bc00",
  brightYellow: "#949800",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

const darkThemeColors: ITheme = {
  background: "#0f172a",
  foreground: "#eff0eb",
  selectionBackground: "#97979b33",
  cursor: "#eff0eb",
  cursorAccent: "#0f172a",
  black: "#000000",
  red: "#ff5c57",
  green: "#5af78e",
  yellow: "#f3f99d",
  blue: "#57c7ff",
  magenta: "#ff6ac1",
  cyan: "#9aedfe",
  white: "#f1f1f0",
  brightBlack: "#686868",
  brightRed: "#ff5c57",
  brightGreen: "#5af78e",
  brightYellow: "#f3f99d",
  brightBlue: "#57c7ff",
  brightMagenta: "#ff6ac1",
  brightCyan: "#9aedfe",
  brightWhite: "#f1f1f0",
};

export function getTerminalTheme(
  themeMode: Theme,
  overrides?: Partial<ITheme>
): ITheme {
  const baseTheme = themeMode === "light" ? lightThemeColors : darkThemeColors;
  return { ...baseTheme, ...overrides };
}
