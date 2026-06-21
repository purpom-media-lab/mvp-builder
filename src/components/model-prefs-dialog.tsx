"use client";

/**
 * 工程（機能）ごとのモデル設定モーダル。
 * 各工程に provider/model を割り当て、localStorage（projectId 単位）に保存する。
 * 「高速」「賢さ優先」プリセットと「既定に戻す」で一括設定できる。
 */
import { useEffect, useState } from "react";
import { type LlmProvider, MODEL_CATALOG, PROVIDERS } from "@/lib/ai/catalog";
import { postJson } from "@/lib/api-client";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelSelection } from "@/components/model-selector";
import {
  ALL_PREF_KEYS,
  buildPreset,
  defaultModelForKey,
  getUsageStats,
  type ModelPref,
  type ModelPrefs,
  PREF_GROUPS,
  type PrefKey,
  saveModelPrefs,
  summarizeStepUsage,
  type UsageStats,
} from "@/lib/model-prefs";

/** /api/optimize-models が返す 1 工程ぶんの推奨。 */
interface Recommendation {
  step: string;
  provider: LlmProvider;
  modelId: string;
  rationale: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 現在選択中のモデル（未設定キーの既定の基準）。 */
  baseModel: ModelSelection;
  prefs: ModelPrefs;
  /** 保存時に親へ反映。 */
  onSave: (prefs: ModelPrefs) => void;
}

/** 1工程ぶんの provider/model セレクタ（設定済みかどうかも表示）。 */
function PrefRow({
  label,
  prefKey,
  value,
  isSet,
  onChange,
  usage,
  rationale,
}: {
  label: string;
  prefKey: PrefKey;
  value: ModelPref;
  isSet: boolean;
  onChange: (key: PrefKey, value: ModelPref) => void;
  /** この工程の利用統計（履歴が無ければ null）。 */
  usage: { count: number; avgMs: number; okRate: number } | null;
  /** AI最適化が付けた推奨理由（あれば表示）。 */
  rationale?: string;
}) {
  const models = MODEL_CATALOG[value.provider].models;
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="w-40 shrink-0 text-sm">
        {label}
        {isSet ? null : (
          <span className="ml-1 text-[0.65rem] text-muted-foreground">（既定）</span>
        )}
        <span className="block text-[0.65rem] text-muted-foreground">
          {usage
            ? `平均 ${usage.avgMs.toLocaleString()}ms・${usage.count}回・成功 ${Math.round(
                usage.okRate * 100,
              )}%`
            : "履歴なし"}
        </span>
        {rationale ? (
          <span className="block text-[0.65rem] leading-tight text-primary/80">
            💡 {rationale}
          </span>
        ) : null}
      </span>
      <Select
        value={value.provider}
        onValueChange={(v) => {
          if (!v) return;
          const provider = v as LlmProvider;
          onChange(prefKey, {
            provider,
            modelId: MODEL_CATALOG[provider].defaultModel,
          });
        }}
      >
        <SelectTrigger size="sm" className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((p) => (
            <SelectItem key={p} value={p}>
              {MODEL_CATALOG[p].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.modelId}
        onValueChange={(v) => v && onChange(prefKey, { ...value, modelId: v })}
      >
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ModelPrefsDialog({
  open,
  onClose,
  projectId,
  baseModel,
  prefs,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<ModelPrefs>(prefs);
  // 利用統計（開くたびに localStorage から再集計）
  const [usageStats, setUsageStats] = useState<UsageStats>({});
  // AI最適化の状態
  const [optimizing, setOptimizing] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optimized, setOptimized] = useState(false);
  // 工程キー -> 推奨理由
  const [rationales, setRationales] = useState<Record<string, string>>({});

  // モーダルを開くたびに現在の設定で初期化する
  useEffect(() => {
    if (open) {
      setDraft(prefs);
      setUsageStats(getUsageStats(projectId));
      setOptError(null);
      setOptimized(false);
      setRationales({});
    }
  }, [open, prefs, projectId]);

  function setKey(key: PrefKey, value: ModelPref) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // 利用履歴＋工程性質から、AIに工程ごとの最適モデルを提案させる
  async function optimizeFromUsage() {
    setOptimizing(true);
    setOptError(null);
    try {
      const stats = getUsageStats(projectId);
      setUsageStats(stats);
      const data = await postJson<{ recommendations: Recommendation[] }>(
        "/api/optimize-models",
        {
          stats,
          steps: ALL_PREF_KEYS,
          providers: PROVIDERS,
          provider: baseModel.provider,
          modelId: baseModel.modelId,
        },
      );
      const recs = data.recommendations ?? [];
      if (!recs.length) {
        setOptError("提案が得られませんでした。もう一度お試しください。");
        return;
      }
      setDraft((d) => {
        const next = { ...d };
        for (const r of recs) {
          next[r.step as PrefKey] = {
            provider: r.provider,
            modelId: r.modelId,
          };
        }
        return next;
      });
      setRationales(
        Object.fromEntries(recs.map((r) => [r.step, r.rationale])),
      );
      setOptimized(true);
    } catch (e) {
      setOptError(e instanceof Error ? e.message : "最適化に失敗しました");
    } finally {
      setOptimizing(false);
    }
  }

  function applyPreset(kind: "fast" | "smart") {
    setDraft(buildPreset(kind, baseModel));
  }

  function resetToDefault() {
    setDraft({});
  }

  function save() {
    saveModelPrefs(projectId, draft);
    onSave(draft);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="⚙️ モデル設定（工程ごと）" size="md">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          工程ごとに使うモデルを選べます。未設定の工程は、軽い工程は高速モデル・それ以外は
          現在選択中のモデルが既定で使われます。設定はこのブラウザに保存されます。
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => applyPreset("fast")}>
            ⚡ 高速プリセット
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("smart")}>
            🧠 賢さ優先プリセット
          </Button>
          <Button
            size="sm"
            onClick={optimizeFromUsage}
            disabled={optimizing}
            title="この端末の利用履歴（速度・成功率）と工程の性質から、AIが工程ごとの最適モデルを提案します"
          >
            {optimizing ? "最適化中…" : "🤖 利用履歴からAIで最適化"}
          </Button>
          <Button size="sm" variant="ghost" onClick={resetToDefault}>
            既定に戻す
          </Button>
        </div>

        {optError && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {optError}
          </div>
        )}
        {optimized && !optError && (
          <div className="rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
            AIが各工程に推奨モデルを設定しました。内容を確認して「保存」してください。
          </div>
        )}
        <p className="text-[0.7rem] text-muted-foreground">
          履歴が少ない工程は、工程の性質（軽い抽出系 / 重い推論系）とモデル特性をもとに提案されます。
        </p>

        <div className="space-y-4">
          {PREF_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <div className="divide-y rounded-lg border px-3">
                {group.keys.map(({ key, label }) => (
                  <PrefRow
                    key={key}
                    label={label}
                    prefKey={key}
                    isSet={!!draft[key]}
                    value={draft[key] ?? defaultModelForKey(key, baseModel)}
                    onChange={setKey}
                    usage={summarizeStepUsage(usageStats, key)}
                    rationale={rationales[key]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={save}>保存</Button>
        </div>
      </div>
    </Modal>
  );
}
