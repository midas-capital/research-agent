import axios from "axios";
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
    throw new Error("SERPER_API_KEY or SERPAPI_API_KEY is not set");
  }
  const num = Math.min(10, Math.max(searchPerCategory.min, searchPerCategory.max));
  const body: Record<string, string | number> = {
    q: query,
    num,
  };
  if (lang === "ja") {
    body.gl = "jp";
    body.hl = "ja";
  } else {
    body.gl = "us";
    body.hl = "en";
  }

  const { data } = await axios.post<{
    organic?: Array<{ link?: string; title?: string; snippet?: string }>;
  }>("https://google.serper.dev/search", body, {
    headers: {
      "X-API-KEY": config.serpApiKey,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
  const results = data.organic ?? [];
  return results
    .filter((r) => r.link)
    .slice(0, num)
    .map((r) => ({
      url: r.link!,
      title: r.title ?? "",
      snippet: r.snippet ?? "",
    }));
}
