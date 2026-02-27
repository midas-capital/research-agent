import axios from "axios";
import type { SearchResultItem } from "../types.js";

const http = axios.create({
  timeout: 15000,
  maxRedirects: 3,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; ResearchAgent/1.0; +https://github.com/research-agent)",
  },
  validateStatus: () => true,
});

/**
 * フェーズ8: URLに並列アクセスしてHTMLを取得
 */
export async function fetchHtmlBatch(
  items: SearchResultItem[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  await Promise.all(
    items.map(async (item) => {
      try {
        const res = await http.get<string>(item.url, {
          responseType: "text",
          maxContentLength: 1024 * 1024, // 1MB
        });
        if (res.status === 200 && typeof res.data === "string") {
          results.set(item.url, res.data);
        }
      } catch {
        // skip failed URLs
      }
    })
  );
  return results;
}
