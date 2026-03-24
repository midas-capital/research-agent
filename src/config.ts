import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 初期は料金・トークンを抑えるため件数を少なめに。
// LIGHT_MODE=true（デフォルト）では軽量設定になり、必要に応じて個別の環境変数で上書きできます。
const lightMode = process.env.LIGHT_MODE !== "false"; // デフォルト true（少なめ）

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const defaultMaxAxes = lightMode ? 2 : 5;
const defaultMaxCategoriesPerAxis = lightMode ? 2 : 5;
const defaultMaxCasesTarget = lightMode ? 10 : 100;
const defaultMaxSupplementRounds = lightMode ? 0 : 3;

const searchMinDefault = lightMode ? 2 : 5;
const searchMaxDefault = lightMode ? 3 : 7;

const searchMin = toNumber(process.env.SEARCH_PER_CATEGORY_MIN, searchMinDefault);
const searchMaxRaw = toNumber(process.env.SEARCH_PER_CATEGORY_MAX, searchMaxDefault);
const searchMax = Math.max(searchMin, searchMaxRaw);

export const config = {
  // ファイル保存先は固定（環境変数では切り替えない）
  dataDir: path.join(root, "data"),
  outputDir: path.join(root, "output"),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Web 検索用 API キー（Serper.dev 推奨。なければ互換の SERPAPI_API_KEY も見る）
  serpApiKey: process.env.SERPER_API_KEY ?? process.env.SERPAPI_API_KEY ?? "",
  // 目標とする事例数（補充前後を含めた最終件数の目安）
  maxCasesTarget: toNumber(process.env.MAX_CASES_TARGET, defaultMaxCasesTarget),
  // 補充ラウンド数（0 なら補充なし）
  maxSupplementRounds: toNumber(
    process.env.MAX_SUPPLEMENT_ROUNDS,
    defaultMaxSupplementRounds
  ),
  // 1 カテゴリあたりの検索クエリから取得する URL 数の範囲
  searchPerCategory: { min: searchMin, max: searchMax },
  // 軸の最大数・1軸あたりのカテゴリ最大数
  maxAxes: toNumber(process.env.MAX_AXES, defaultMaxAxes),
  maxCategoriesPerAxis: toNumber(
    process.env.MAX_CATEGORIES_PER_AXIS,
    defaultMaxCategoriesPerAxis
  ),
  contentMaxChars: 3000,
} as const;

export function getRunStatePath(runId: string): string {
  return path.join(config.dataDir, "runs", `${runId}.json`);
}

export function getExcelPath(runId: string): string {
  return path.join(config.outputDir, `cases-${runId}.xlsx`);
}
