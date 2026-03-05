import { openai } from "./openai-client.js";
import { config } from "../config.js";
import type { Axis } from "../types.js";

const { maxAxes, maxCategoriesPerAxis } = config;

/**
 * フェーズ5: クエリを分析して軸・カテゴリを生成 (Claude Sonnet)
 * 件数は config の maxAxes / maxCategoriesPerAxis に従う
 */
export async function generateAxesAndCategories(query: string): Promise<Axis[]> {
  const axisRule =
    maxAxes <= 2
      ? "軸は2個にすること。各軸には2個のカテゴリを付けること。"
      : `軸は${maxAxes}個まで、各軸には${maxCategoriesPerAxis}個までのカテゴリにすること。`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: `あなたは事例調査の専門家です。以下のユーザーの質問・テーマを分析し、事例を収集するための「分類軸」を設計してください。

## ルール
- ${axisRule}
- カテゴリは、実際にWeb検索でヒットしやすい具体的な言葉にすること
- ビジネス・導入事例が集まりそうな軸・カテゴリにすること

## ユーザーの質問・テーマ
${query}

## 出力形式（JSONオブジェクトのみ、説明不要）
{
  "axes": [
    { "name": "軸の名前", "categories": ["カテゴリ1", "カテゴリ2"] },
    { "name": "軸の名前2", "categories": ["カテゴリA", "カテゴリB"] }
  ]
}`,
      },
    ],
  });

  const message = completion.choices[0]?.message;
  const text = (message?.content as string) ?? "";
  const parsed = JSON.parse(text) as { axes?: Axis[] };
  const axes = parsed.axes ?? [];
  if (!Array.isArray(axes) || axes.length === 0) {
    throw new Error("Invalid axes response: expected non-empty array");
  }
  return axes.slice(0, maxAxes).map((a) => ({
    name: String(a.name),
    categories: (Array.isArray(a.categories) ? a.categories : []).slice(0, maxCategoriesPerAxis).map(String),
  }));
}
