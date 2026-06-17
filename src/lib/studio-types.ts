/** Studio 画面で扱う分析成果物のビュー型（クライアント共通） */

export type StepKey =
  | "actors"
  | "usecases"
  | "ooui"
  | "journey"
  | "navigation"
  | "wireframe"
  | "datamodel"
  | "backend";

export type WireframeSection = {
  type: string;
  label: string;
  items?: string[] | null;
};
export type WireframeView = {
  screenName: string;
  screenType?: string | null;
  sections: WireframeSection[];
};

export type ActorView = {
  name: string;
  description?: string | null;
  kind?: string | null;
};
export type UseCaseView = {
  actorName?: string;
  goal: string;
  description?: string | null;
};
export type OouiView = {
  name: string;
  attributes?: string[] | null;
  actions?: string[] | null;
  // 編集時に失わないよう保持（UIでは直接編集しないが保存時に引き回す）
  collectionOf?: string | null;
  relations?: { to: string; type: string }[] | null;
};
export type JourneyStep = {
  step: string;
  touchpoint?: string | null;
  emotion?: string | null;
};
export type JourneyView = { name: string; steps: JourneyStep[] };
export type DataModelField = { name: string; type: string };
export type DataModelRelation = { to: string; type: string };
export type DataModelView = {
  name: string;
  fields: DataModelField[];
  relations?: DataModelRelation[] | null;
};
export type NavView = {
  label: string;
  targetObject?: string | null;
  screenType?: string | null;
  parent?: string | null;
  icon?: string | null;
};
export type BackendView = {
  needsAuth: boolean;
  needsStorage: boolean;
  needsDb: boolean;
  rationale?: string | null;
};
