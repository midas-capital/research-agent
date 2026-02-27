import { getJson } from "serpapi";
import { config } from "../config.js";
import type { SearchResultItem } from "../types.js";

const { searchPerCategory } = config;

/**
 * フェーズ7: 1クエリで5〜7件のURL＋スニペットを取得
 */
export async function searchWeb(
  query: string,
  lang: "ja" | "en"
): Promise<SearchResultItem[]> {
  if (!config.serpApiKey) {
    throw new Error("SERPAPI_API_KEY is not set");
  }
  const num = Math.min(10, Math.max(searchPerCategory.min, searchPerCategory.max));
  const params: Record<string, string | number> = {
    engine: "google",
    api_key: config.serpApiKey,
    q: query,
    num,
  };
  if (lang === "ja") {
    params.gl = "jp";
    params.hl = "ja";
  } else {
    params.gl = "us";
    params.hl = "en";
  }

  const data = (await getJson(params)) as {
    organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
  };
  const results = data.organic_results ?? [];
  return results
    .filter((r) => r.link)
    .slice(0, num)
    .map((r) => ({
      url: r.link!,
      title: r.title ?? "",
      snippet: r.snippet ?? "",
    }));
}
