import type { CaseItem } from "../types.js";

/**
 * URL と 「企業名＋課題」の組み合わせの両方を使って重複を除去する。
 * 先に現れたレコードを優先し、2 件目以降は配列から取り除く。
 */
export function dedupCases(cases: CaseItem[]): CaseItem[] {
  const seenUrls = new Set<string>();
  const seenCompanyChallenge = new Set<string>();
  const result: CaseItem[] = [];

  for (const c of cases) {
    const urlKey = c.url.toLowerCase().trim();
    const ccKey = `${(c.companyName || "").trim()}|${(c.challenge || "").trim()}`.toLowerCase();

    const hasUrl = seenUrls.has(urlKey);
    const hasCC = ccKey && ccKey !== "|" && seenCompanyChallenge.has(ccKey);

    if (hasUrl || hasCC) {
      continue;
    }

    seenUrls.add(urlKey);
    if (ccKey && ccKey !== "|") {
      seenCompanyChallenge.add(ccKey);
    }
    result.push(c);
  }

  return result;
}
