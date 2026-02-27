import * as cheerio from "cheerio";
import { config } from "../config.js";
import type { PageContent } from "../types.js";

const MAX_CHARS = config.contentMaxChars;

/**
 * フェーズ9: script・style・nav・header・footer・広告を除去し、
 * 見出し・本文・タイトル・metaだけをJSONに変換。3000文字に制限。
 */
export function htmlToStructuredJson(html: string, url: string): PageContent {
  const $ = cheerio.load(html);

  // 不要タグを削除
  $(
    "script, style, nav, header, footer, [role='navigation'], [role='banner'], .ad, .ads, .advertisement, iframe, noscript"
  ).remove();

  const title =
    $("title").first().text().trim() ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    "";

  const meta: Record<string, string> = {};
  $("meta[name], meta[property]").each((_, el) => {
    const name =
      $(el).attr("name") ?? $(el).attr("property") ?? "";
    const content = $(el).attr("content") ?? "";
    if (name && content) meta[name] = content;
  });

  const headings: string[] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const t = $(el).text().trim();
    if (t) headings.push(t);
  });

  const bodyParts: string[] = [];
  $("main, article, [role='main'], .content, .post, .entry-content, #content, body")
    .first()
    .find("p, li, td, th")
    .each((_, el) => {
    bodyParts.push($(el).text().trim());
  });

  if (bodyParts.length === 0) {
    $("body p, body li").each((_, el) => {
      bodyParts.push($(el).text().trim());
    });
  }

  let body = bodyParts.filter(Boolean).join("\n").replace(/\s+/g, " ").trim();
  if (body.length > MAX_CHARS) {
    body = body.slice(0, MAX_CHARS) + "...";
  }

  return { title, meta, headings, body, url };
}
