/**
 * 事例調査エージェント - 共通型定義
 */

export interface Axis {
  name: string;
  categories: string[];
}

export interface CaseItem {
  url: string;
  title: string;
  companyName: string;
  challenge: string;
  solution: string;
  effect: string;
  axisName: string;
  categoryName: string;
  duplicateOf?: string; // URL or "company+challenge" key when duplicate
  snippet?: string;
}

export interface RunState {
  runId: string;
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  axes?: Axis[];
  cases?: CaseItem[];
  excelPath?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
}

export interface PageContent {
  title: string;
  meta?: Record<string, string>;
  headings: string[];
  body: string;
  url: string;
}
