import { openai } from "./openai-client.js";
import { config } from "../config.js";

/**
 * フェーズ6: 各カテゴリを日本語・英語の検索クエリに変換
 * （Haiku が使えない環境向けに Sonnet 4.5 を使用）
 */
export async function categoryToSearchQueries(
  axisName: string,
  categoryName: string,
  userQuery: string
): Promise<{ ja: string; en: string }> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
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

  const message = completion.choices[0]?.message;
  const text = (message?.content as string) ?? "";
  const parsed = text ? JSON.parse(text) : {};
  return {
    ja: String(parsed.ja ?? `${userQuery} ${categoryName} 事例`).trim(),
    en: String(parsed.en ?? `${userQuery} ${categoryName} case study`).trim(),
  };
}
