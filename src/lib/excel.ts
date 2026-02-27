import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs/promises";
import { getExcelPath } from "../config.js";
import type { Axis, CaseItem } from "../types.js";

export async function writeExcel(
  runId: string,
  axes: Axis[],
  cases: CaseItem[]
): Promise<string> {
  const outPath = getExcelPath(runId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "事例調査エージェント";

  const summary = workbook.addWorksheet("サマリー", { views: [{ state: "frozen", ySplit: 1 }] });
  summary.columns = [
    { header: "軸", key: "axis", width: 20 },
    { header: "カテゴリ数", key: "categories", width: 12 },
    { header: "事例数", key: "count", width: 10 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const a of axes) {
    const count = cases.filter((c) => c.axisName === a.name).length;
    summary.addRow({ axis: a.name, categories: a.categories.length, count });
  }
  summary.addRow({});
  summary.addRow({ axis: "合計", categories: "-", count: cases.length });

  for (const axis of axes) {
    const name = axis.name.slice(0, 31);
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "企業名", key: "companyName", width: 24 },
      { header: "課題", key: "challenge", width: 36 },
      { header: "解決策", key: "solution", width: 36 },
      { header: "効果", key: "effect", width: 28 },
      { header: "URL", key: "url", width: 48 },
      { header: "重複", key: "duplicate", width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };
    const axisCases = cases.filter((c) => c.axisName === axis.name);
    for (const c of axisCases) {
      sheet.addRow({
        companyName: c.companyName,
        challenge: c.challenge,
        solution: c.solution,
        effect: c.effect,
        url: c.url,
        duplicate: (c as CaseItem & { duplicateOf?: string }).duplicateOf ? "重複" : "",
      });
    }
  }

  const all = workbook.addWorksheet("全事例", { views: [{ state: "frozen", ySplit: 1 }] });
  all.columns = [
    { header: "軸", key: "axisName", width: 18 },
    { header: "カテゴリ", key: "categoryName", width: 18 },
    { header: "企業名", key: "companyName", width: 22 },
    { header: "課題", key: "challenge", width: 32 },
    { header: "解決策", key: "solution", width: 32 },
    { header: "効果", key: "effect", width: 24 },
    { header: "URL", key: "url", width: 44 },
  ];
  all.getRow(1).font = { bold: true };
  for (const c of cases) {
    all.addRow({
      axisName: c.axisName,
      categoryName: c.categoryName,
      companyName: c.companyName,
      challenge: c.challenge,
      solution: c.solution,
      effect: c.effect,
      url: c.url,
    });
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);
  return outPath;
}
