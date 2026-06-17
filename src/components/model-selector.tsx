"use client";

import { type LlmProvider, MODEL_CATALOG, PROVIDERS } from "@/lib/ai/catalog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ModelSelection {
  provider: LlmProvider;
  modelId: string;
}

interface Props {
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
}

/** Claude / OpenAI / Gemini と各モデルを選択するセレクタ */
export function ModelSelector({ value, onChange }: Props) {
  const models = MODEL_CATALOG[value.provider].models;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.provider}
        onValueChange={(v) => {
          if (!v) return;
          const provider = v as LlmProvider;
          onChange({ provider, modelId: MODEL_CATALOG[provider].defaultModel });
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
        onValueChange={(v) => v && onChange({ ...value, modelId: v })}
      >
        <SelectTrigger size="sm" className="w-[170px]">
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
