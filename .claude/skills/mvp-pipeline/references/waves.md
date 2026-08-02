<!-- 自動生成: scripts/gen-claude-skill.ts が src/lib/ai/step-specs.ts から生成。手で編集しない。 -->

# 実行ウェーブ（依存順）

同一ウェーブ内の工程は**依存関係がないので同時に起動する**（1メッセージで複数の Task を発行する）。
後段のウェーブは、前段までの `artifacts/*.json` をすべて参照できる。

1. `actors`
2. `usecases`
3. `journey`
4. `market`
5. `ooui` / `scope` / `brand`  ← 並列
6. `navigation` / `datamodel` / `kpi`  ← 並列
7. `wireframe` / `backend` / `growth`  ← 並列

# 工程一覧

| ウェーブ | キー | 工程 | 担当ロール | モデル | 本体のモデル |
| --- | --- | --- | --- | --- | --- |
| 1 | `actors` | アクター整理 | ビジネスアナリスト | sonnet | haiku |
| 2 | `usecases` | ユースケース書き出し | ビジネスアナリスト | sonnet | haiku |
| 3 | `journey` | ジャーニー整理 | UXデザイナー | sonnet | haiku |
| 4 | `market` | 市場・競合分析 | 事業開発／市場アナリスト | sonnet | 同左 |
| 5 | `ooui` | OOUI分析（オブジェクト抽出） | UXアーキテクト | sonnet | 同左 |
| 5 | `scope` | スコープ確定 | プロダクトマネージャー | sonnet | 同左 |
| 5 | `brand` | ブランド設計 | ブランドデザイナー | sonnet | 同左 |
| 6 | `navigation` | ナビゲーション設計（メインナビ） | 情報設計（IA）デザイナー | sonnet | 同左 |
| 6 | `datamodel` | データ設計 | データアーキテクト | sonnet | 同左 |
| 6 | `kpi` | KPI設定 | グロース／データアナリスト | sonnet | 同左 |
| 7 | `wireframe` | ワイヤーフレーム設計 | UIデザイナー | sonnet | 同左 |
| 7 | `backend` | バックエンド要否判定 | バックエンドエンジニア | sonnet | 同左 |
| 7 | `growth` | グロース計画 | グロース担当 | sonnet | 同左 |

Claude Code 版は全工程を `sonnet` で回す。本体が `haiku` を使う工程（actors/usecases/journey）も
ここでは落とさない — 上流工程が薄いと下流のウェーブすべてに連鎖するため（根拠は
`scripts/gen-claude-skill.ts` の `AGENT_MODEL` のコメント）。

# ウェーブ順序の根拠

- `journey` は体験レンズ。抽出した painpoint / opportunity を `scope` の優先度判断に流すため `scope` の前。
- `market` は市場規模(TAM/SAM/SOM)・競合・参入余地。`scope` の優先度判断と差別化仮説の材料になるため `ooui`/`scope` の前。
- `navigation` は OOUI オブジェクト/関連の構造推論が要るため、本体でも高速モデルの対象外。
