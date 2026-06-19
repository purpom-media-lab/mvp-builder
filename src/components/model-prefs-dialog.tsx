"use client";

/**
 * 工程（機能）ごとのモデル設定モーダル。
 * 各工程に provider/model を割り当て、localStorage（projectId 単位）に保存する。
 * 「高速」「賢さ優先」プリセットと「既定に戻す」で一括設定できる。
 */
import { useEffect, useState } from "react";
import { type LlmProvider, MODEL_CATALOG, PROVIDERS } from "@/lib/ai/catalog";
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
  buildPreset,
  defaultModelForKey,
  type ModelPref,
  type ModelPrefs,
  PREF_GROUPS,
  type PrefKey,
  saveModelPrefs,
} from "@/lib/model-prefs";

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
}: {
  label: string;
  prefKey: PrefKey;
  value: ModelPref;
  isSet: boolean;
  onChange: (key: PrefKey, value: ModelPref) => void;
}) {
  const models = MODEL_CATALOG[value.provider].models;
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="w-40 shrink-0 text-sm">
        {label}
        {isSet ? null : (
          <span className="ml-1 text-[0.65rem] text-muted-foreground">（既定）</span>
        )}
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

  // モーダルを開くたびに現在の設定で初期化する
  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  function setKey(key: PrefKey, value: ModelPref) {
    setDraft((d) => ({ ...d, [key]: value }));
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
          <Button size="sm" variant="ghost" onClick={resetToDefault}>
            既定に戻す
          </Button>
        </div>

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
