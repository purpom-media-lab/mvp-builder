"use client";

import { CommandPalette } from "@/components/command-palette";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
      <CommandPalette />
    </ThemeProvider>
  );
}
