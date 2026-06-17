"use client";

/**
 * ⌘K / Ctrl+K で開くグローバルコマンドパレット。
 * プロジェクト横断移動・テーマ切替・新規作成などをキーボードから実行。
 */
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type Project = { id: string; name: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, [open]);

  const run = useCallback((fn: () => void) => {
    setOpen(false);
    fn();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="コマンド・プロジェクトを検索…" />
        <CommandList>
        <CommandEmpty>該当なし</CommandEmpty>
        <CommandGroup heading="移動">
          <CommandItem onSelect={() => run(() => router.push("/studio"))}>
            プロジェクト一覧
          </CommandItem>
        </CommandGroup>
        {projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="プロジェクト">
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`project ${p.name}`}
                  onSelect={() => run(() => router.push(`/studio/${p.id}`))}
                >
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="表示">
          <CommandItem
            onSelect={() =>
              run(() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark"),
              )
            }
          >
            {resolvedTheme === "dark"
              ? "ライトモードに切替"
              : "ダークモードに切替"}
          </CommandItem>
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
