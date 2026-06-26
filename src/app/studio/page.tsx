"use client";

/**
 * プロジェクト一覧（Project のコレクションビュー）。
 * カードグリッドで一覧表示し、クリックで /studio/[id] へ。新規作成はダイアログ。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GlobalHeader } from "@/components/global-header";
import { PageLoading } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type SourceType = "text" | "url" | "pdf";

/** File を base64 文字列（data URL のプレフィックスなし）へ変換 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("ファイルの読み込みに失敗しました"));
        return;
      }
      // "data:application/pdf;base64,XXXX" → "XXXX"
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

type Project = {
  id: string;
  name: string;
  summary?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  hasPrototype?: boolean;
  recordCount?: number;
  endUserCount?: number;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  analyzing: "分析中",
  designing: "設計中",
  generating: "生成中",
  published: "公開済",
};

export default function ProjectListPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("text");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const d = await res.json();
        setProjects(d.projects ?? []);
      }
    } finally {
      setLoadingList(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function remove(p: Project) {
    if (
      !window.confirm(
        `「${p.name}」を削除しますか？\n分析・プロトタイプ・保存データ・エンドユーザーもすべて削除され、元に戻せません。`,
      )
    )
      return;
    setDeletingId(p.id);
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (res.ok) setProjects((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setDeletingId(null);
    }
  }

  async function create() {
    if (!name.trim()) {
      setError("プロジェクト名を入力してください");
      return;
    }
    // ソース種別ごとの入力バリデーション
    if (sourceType === "url" && !sourceUrl.trim()) {
      setError("URL を入力してください");
      return;
    }
    if (sourceType === "pdf" && !pdfFile) {
      setError("PDF ファイルを選択してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: {
        name: string;
        summary: string;
        sourceType: SourceType;
        sourceText?: string;
        sourceUrl?: string;
        sourcePdf?: string;
      } = { name, summary, sourceType };
      if (sourceType === "text") payload.sourceText = sourceText;
      else if (sourceType === "url") payload.sourceUrl = sourceUrl;
      else if (sourceType === "pdf" && pdfFile)
        payload.sourcePdf = await fileToBase64(pdfFile);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "作成に失敗しました");
      router.push(`/studio/${d.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
      setBusy(false);
    }
  }

  return (
    <div className="pm-sky relative isolate min-h-screen">
      <GlobalHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="pm-eyebrow">projects</p>
            <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
              プロジェクト
            </h1>
            <p className="mt-1 text-sm text-base-content/70">
              要件 → 可視化 → スコープ確定 → 動くMVP
            </p>
          </div>
          <Button
            onClick={() => {
              setName("");
              setSummary("");
              setSourceType("text");
              setSourceText("");
              setSourceUrl("");
              setPdfFile(null);
              setError(null);
              setOpen(true);
            }}
          >
            ＋ 新規プロジェクト
          </Button>
        </div>

        {loadingList ? (
          <PageLoading label="プロジェクトを読み込み中…" />
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-base-content/70">
              まだプロジェクトがありません。「＋
              新規プロジェクト」から作成してください。
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="flex h-full flex-col gap-3 ring-base-300 transition-colors hover:ring-primary/50"
              >
                <Link href={`/studio/${p.id}`} className="flex-1">
                  <CardHeader>
                    <CardTitle className="truncate">{p.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-2 h-10 text-sm text-base-content/70">
                      {p.summary || "（概要なし）"}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-xs text-base-content/70">
                      <Badge variant="secondary">
                        {STATUS_LABEL[p.status ?? "draft"] ?? p.status}
                      </Badge>
                      <span>
                        {p.updatedAt
                          ? new Date(p.updatedAt).toLocaleDateString("ja-JP")
                          : ""}
                      </span>
                    </div>
                  </CardContent>
                </Link>
                {/* 管理フッター: 公開MVP / 利用状況 / 削除 */}
                <CardContent className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
                  <div className="flex items-center gap-3 text-base-content/70">
                    {p.hasPrototype ? (
                      <a
                        href={`/run/${p.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline"
                        title="公開中のMVPを開く"
                      >
                        🔌 公開MVP ↗
                      </a>
                    ) : (
                      <span className="text-base-content/70/60">未公開</span>
                    )}
                    <span title="エンドユーザー数">👤 {p.endUserCount ?? 0}</span>
                    <span title="保存データ数">🗃 {p.recordCount ?? 0}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-error hover:bg-error/10 hover:text-error"
                    disabled={deletingId === p.id}
                    onClick={() => remove(p)}
                  >
                    {deletingId === p.id ? "削除中…" : "削除"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新規プロジェクト</DialogTitle>
              <DialogDescription>
                アイデア・要件を入力して分析を始めます。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {error && (
                <div className="rounded-md bg-error/10 px-4 py-3 text-sm text-error">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="p-name">プロジェクト名</Label>
                <Input
                  id="p-name"
                  placeholder="例: AIセールスリード・オートパイロット"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-summary">概要</Label>
                <Input
                  id="p-summary"
                  placeholder="一言で"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>入力資料</Label>
                <Tabs
                  value={sourceType}
                  onValueChange={(v) => {
                    setSourceType(v as SourceType);
                    setError(null);
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="text">テキスト</TabsTrigger>
                    <TabsTrigger value="url">URL</TabsTrigger>
                    <TabsTrigger value="pdf">PDF</TabsTrigger>
                  </TabsList>
                </Tabs>
                {sourceType === "text" && (
                  <Textarea
                    id="p-source"
                    className="h-40"
                    placeholder="アイデア・要件・参考テキストを貼り付け"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                  />
                )}
                {sourceType === "url" && (
                  <Input
                    id="p-source-url"
                    type="url"
                    placeholder="https://example.com/spec"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                )}
                {sourceType === "pdf" && (
                  <Input
                    id="p-source-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={busy}>
                {busy ? "作成中…" : "作成して開く"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
