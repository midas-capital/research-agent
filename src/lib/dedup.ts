import type { CaseItem } from "../types.js";

/**
 * フェーズ12: URLと企業名＋課題の組み合わせで重複を検出。削除せず重複フラグを立てる。
 */
export function flagDuplicates(cases: CaseItem[]): CaseItem[] {
  const byUrl = new Map<string, CaseItem>();
  const byCompanyChallenge = new Map<string, CaseItem>();

  for (const c of cases) {
    const urlKey = c.url.toLowerCase().trim();
    const ccKey = `${(c.companyName || "").trim()}|${(c.challenge || "").trim()}`.toLowerCase();
    if (!ccKey || ccKey === "|") continue;

    const firstByUrl = byUrl.get(urlKey);
    const firstByCC = byCompanyChallenge.get(ccKey);

    if (firstByUrl && firstByUrl !== c) {
      (c as CaseItem & { duplicateOf?: string }).duplicateOf = firstByUrl.url;
    } else {
      byUrl.set(urlKey, c);
    }

    if (firstByCC && firstByCC !== c) {
      (c as CaseItem & { duplicateOf?: string }).duplicateOf =
        (c as CaseItem & { duplicateOf?: string }).duplicateOf ?? `${firstByCC.companyName}|${firstByCC.challenge}`;
    } else if (!firstByCC) {
      byCompanyChallenge.set(ccKey, c);
    }
  }

  return cases;
}
