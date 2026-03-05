import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/**
 * フェーズ6: 各カテゴリを日本語・英語の検索クエリに変換
 * （Haiku が使えない環境向けに Sonnet 4.5 を使用）
 */
export async function categoryToSearchQueries(
  axisName: string,
  categoryName: string,
  userQuery: string
): Promise<{ ja: string; en: string }> {
  const { content } = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `以下の軸・カテゴリについて、Web検索用のクエリを1つずつ作ってください。事例・導入事例がヒットしやすい表現にしてください。

ユーザーのテーマ: ${userQuery}
軸: ${axisName}
カテゴリ: ${categoryName}

出力はJSONのみ（説明不要）:
{"ja": "日本語の検索クエリ", "en": "English search query"}`,
      },
    ],
  });

  const text = content[0].type === "text" ? content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  return {
    ja: String(parsed.ja ?? `${userQuery} ${categoryName} 事例`).trim(),
    en: String(parsed.en ?? `${userQuery} ${categoryName} case study`).trim(),
  };
}
