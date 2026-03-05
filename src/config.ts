import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 初期は料金・トークンを抑えるため件数を少なめに。本番は環境変数で上書き可能
const lightMode = process.env.LIGHT_MODE !== "false"; // デフォルト true（少なめ）

export const config = {
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  outputDir: process.env.OUTPUT_DIR ?? path.join(root, "output"),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  serpApiKey: process.env.SERPAPI_API_KEY ?? "",
  maxCasesTarget: lightMode ? 10 : Number(process.env.MAX_CASES_TARGET) || 100,
  maxSupplementRounds: lightMode ? 0 : Number(process.env.MAX_SUPPLEMENT_ROUNDS) || 3,
  searchPerCategory: lightMode ? { min: 2, max: 3 } : { min: 5, max: 7 },
  maxAxes: lightMode ? 2 : 5,
  maxCategoriesPerAxis: lightMode ? 2 : 5,
  contentMaxChars: 3000,
} as const;

export function getRunStatePath(runId: string): string {
  return path.join(config.dataDir, "runs", `${runId}.json`);
}

export function getExcelPath(runId: string): string {
  return path.join(config.outputDir, `cases-${runId}.xlsx`);
}
