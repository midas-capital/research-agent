import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { CaseItem, PageContent } from "../types.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const caseSchema = `{
  "isCase": boolean,
  "companyName": string | null,
  "challenge": string | null,
  "solution": string | null,
  "effect": string | null
}`;

/**
 * フェーズ10: 事例か否かの選別と、企業名・課題・解決策・効果のJSON化を1回で実行
 * （Haiku が使えない環境向けに Sonnet 4.5 を使用）
 */
export async function screenAndStructure(
  page: PageContent,
  axisName: string,
  categoryName: string,
  snippet: string
): Promise<CaseItem | null> {
  const text = [
    `タイトル: ${page.title}`,
    `URL: ${page.url}`,
    `見出し: ${page.headings.join(" / ")}`,
    `本文（抜粋）: ${page.body.slice(0, 2500)}`,
    `検索スニペット: ${snippet}`,
  ].join("\n");

  const { content } = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `以下のWebページの内容が「企業の導入事例・活用事例・導入効果」に該当するか判定し、該当する場合のみ企業名・課題・解決策・効果を抽出してください。
該当しない場合（製品紹介だけ、ニュース、ブログの感想のみ等）は isCase: false にしてください。

軸: ${axisName}
カテゴリ: ${categoryName}

## ページ内容
${text}

## 出力（JSONのみ、説明不要）
${caseSchema}`,
      },
    ],
  });

  const raw = content[0].type === "text" ? content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  const parsed = JSON.parse(jsonMatch[0]) as {
    isCase?: boolean;
    companyName?: string | null;
    challenge?: string | null;
    solution?: string | null;
    effect?: string | null;
  };
  if (!parsed.isCase) return null;

  const companyName = parsed.companyName?.trim() ?? "";
  const challenge = parsed.challenge?.trim() ?? "";
  const solution = parsed.solution?.trim() ?? "";
  const effect = parsed.effect?.trim() ?? "";
  if (!companyName && !challenge) return null;

  return {
    url: page.url,
    title: page.title,
    companyName,
    challenge,
    solution,
    effect,
    axisName,
    categoryName,
    snippet,
  };
}
