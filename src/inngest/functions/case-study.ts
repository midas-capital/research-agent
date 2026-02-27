import { inngest } from "../client.js";
import { config } from "../../config.js";
import { writeRunState, readRunState } from "../../lib/run-store.js";
import { generateAxesAndCategories } from "../../lib/axes.js";
import { categoryToSearchQueries } from "../../lib/queries.js";
import { searchWeb } from "../../lib/search.js";
import { fetchHtmlBatch } from "../../lib/fetch-html.js";
import { htmlToStructuredJson } from "../../lib/html-to-json.js";
import { screenAndStructure } from "../../lib/screen-structure.js";
import { flagDuplicates } from "../../lib/dedup.js";
import type { Axis, CaseItem, SearchResultItem } from "../../types.js";

const TARGET_COUNT = config.maxCasesTarget;
const MAX_SUPPLEMENT = config.maxSupplementRounds;

interface SearchTask {
  axisName: string;
  categoryName: string;
  queryJa: string;
  queryEn: string;
}

export const caseStudySearch = inngest.createFunction(
  {
    id: "case-study-search",
    name: "事例調査メイン",
    retries: 2,
  },
  { event: "cases/search" },
  async ({ event, step }) => {
    const { runId, query } = event.data as { runId: string; query: string };

    // Phase 5: 軸・カテゴリ生成
    const axes = await step.run("generate-axes", async () => {
      return generateAxesAndCategories(query);
    });

    // Phase 6: 検索クエリ生成（全軸・カテゴリ）
    const searchTasks = await step.run("generate-queries", async () => {
      const tasks: SearchTask[] = [];
      for (const axis of axes) {
        for (const cat of axis.categories) {
          const { ja, en } = await categoryToSearchQueries(axis.name, cat, query);
          tasks.push({ axisName: axis.name, categoryName: cat, queryJa: ja, queryEn: en });
        }
      }
      return tasks;
    });

    // Phase 7: 並列Web検索
    const searchResults = await step.run("search-web", async () => {
      const all: { task: SearchTask; ja: SearchResultItem[]; en: SearchResultItem[] }[] = [];
      for (const task of searchTasks) {
        const [ja, en] = await Promise.all([
          searchWeb(task.queryJa, "ja"),
          searchWeb(task.queryEn, "en"),
        ]);
        all.push({ task, ja, en });
      }
      return all;
    });

    // 検索結果をフラット化（URL重複は後で除く）
    const allSearchItems: (SearchResultItem & { axisName: string; categoryName: string })[] = [];
    for (const r of searchResults) {
      for (const item of [...r.ja, ...r.en]) {
        allSearchItems.push({
          ...item,
          axisName: r.task.axisName,
          categoryName: r.task.categoryName,
        });
      }
    }

    // Phase 8–10: HTML取得 + HTML→JSON + 選別・構造化
    // 1ステップで「HTML→CaseItem[]」まで完結させ、巨大なHTMLマップをStep出力に残さない
    const cases = await step.run("fetch-and-screen", async () => {
      const results: CaseItem[] = [];

      // URL ごとにユニーク化して HTML を取得
      const uniqItems = Array.from(
        new Map(allSearchItems.map((i) => [i.url, i])).values()
      );
      const htmlMap = await fetchHtmlBatch(uniqItems);

      for (const item of allSearchItems) {
        const html = htmlMap.get(item.url);
        if (!html) continue;
        const page = htmlToStructuredJson(html, item.url);
        const c = await screenAndStructure(
          page,
          item.axisName,
          item.categoryName,
          item.snippet ?? ""
        );
        if (c) results.push(c);
      }
      return results;
    });

    // 初回状態を保存して supplement に渡す
    await step.run("save-initial-state", async () => {
      await writeRunState({
        runId,
        query,
        status: "running",
        axes,
        cases,
        createdAt: new Date().toISOString(),
      });
      return { count: cases.length };
    });

    await step.sendEvent("trigger-supplement", {
      name: "cases/supplement",
      data: { runId, query, round: 1 },
    });

    return { runId, initialCount: cases.length };
  }
);

export const caseStudySupplement = inngest.createFunction(
  {
    id: "case-study-supplement",
    name: "事例調査・件数補充",
    retries: 1,
  },
  { event: "cases/supplement" },
  async ({ event, step }) => {
    const { runId, query, round } = event.data as {
      runId: string;
      query: string;
      round: number;
    };

    const state = await step.run("read-state", async () => {
      const s = await readRunState(runId);
      if (!s || !s.axes || !s.cases) throw new Error("Run state not found");
      return s;
    });

    let cases = state.cases!;
    const axes = state.axes!;

    if (cases.length >= TARGET_COUNT || round > MAX_SUPPLEMENT) {
      await step.run("finalize", async () => {
        const deduped = flagDuplicates(cases);
        await writeRunState({
          ...state,
          status: "completed",
          cases: deduped,
          completedAt: new Date().toISOString(),
        });
        return { count: deduped.length };
      });
      return { runId, status: "completed", count: cases.length };
    }

    // 不足カテゴリを特定（事例数が少ない軸・カテゴリ）
    const categoryCount = new Map<string, number>();
    for (const c of cases) {
      const key = `${c.axisName}\t${c.categoryName}`;
      categoryCount.set(key, (categoryCount.get(key) ?? 0) + 1);
    }
    const underperforming: { axis: Axis; category: string }[] = [];
    for (const axis of axes) {
      for (const cat of axis.categories) {
        const key = `${axis.name}\t${cat}`;
        const minPerCategory = Math.max(2, Math.floor(TARGET_COUNT / 10));
        if ((categoryCount.get(key) ?? 0) < minPerCategory) {
          underperforming.push({ axis, category: cat });
        }
      }
    }

    if (underperforming.length === 0) {
      await step.run("finalize-no-supplement", async () => {
        const deduped = flagDuplicates(cases);
        await writeRunState({
          ...state,
          status: "completed",
          cases: deduped,
          completedAt: new Date().toISOString(),
        });
        return { count: deduped.length };
      });
      return { runId, status: "completed" };
    }

    const supplementTasks = await step.run("supplement-queries", async () => {
      const tasks: SearchTask[] = [];
      for (const { axis, category } of underperforming.slice(0, 20)) {
        const { ja, en } = await categoryToSearchQueries(axis.name, category, query);
        tasks.push({
          axisName: axis.name,
          categoryName: category,
          queryJa: ja,
          queryEn: en,
        });
      }
      return tasks;
    });

    const supplementSearchResults = await step.run("supplement-search", async () => {
      const all: { task: SearchTask; ja: SearchResultItem[]; en: SearchResultItem[] }[] = [];
      for (const task of supplementTasks) {
        const [ja, en] = await Promise.all([
          searchWeb(task.queryJa, "ja"),
          searchWeb(task.queryEn, "en"),
        ]);
        all.push({ task, ja, en });
      }
      return all;
    });

    const supplementItems: (SearchResultItem & { axisName: string; categoryName: string })[] = [];
    const existingUrls = new Set(cases.map((c) => c.url));
    for (const r of supplementSearchResults) {
      for (const item of [...r.ja, ...r.en]) {
        if (!existingUrls.has(item.url)) {
          supplementItems.push({
            ...item,
            axisName: r.task.axisName,
            categoryName: r.task.categoryName,
          });
        }
      }
    }

    // 補充分も HTML→CaseItem[] までを1ステップにまとめて、Step出力サイズを抑える
    const newCases = await step.run("supplement-fetch-and-screen", async () => {
      const results: CaseItem[] = [];
      const uniqItems = Array.from(new Map(supplementItems.map((i) => [i.url, i])).values());
      const htmlMap = await fetchHtmlBatch(uniqItems);

      for (const item of supplementItems) {
        const html = htmlMap.get(item.url);
        if (!html) continue;
        const page = htmlToStructuredJson(html, item.url);
        const c = await screenAndStructure(
          page,
          item.axisName,
          item.categoryName,
          item.snippet ?? ""
        );
        if (c) results.push(c);
      }
      return results;
    });

    const merged = [...cases, ...newCases];

    if (merged.length >= TARGET_COUNT || round >= MAX_SUPPLEMENT) {
      await step.run("finalize-after-supplement", async () => {
        const deduped = flagDuplicates(merged);
        await writeRunState({
          ...state,
          status: "completed",
          cases: deduped,
          completedAt: new Date().toISOString(),
        });
        return { count: deduped.length };
      });
      return { runId, status: "completed", count: merged.length };
    }

    await step.run("save-and-continue", async () => {
      await writeRunState({
        ...state,
        cases: merged,
      });
      return { count: merged.length };
    });

    await step.sendEvent("next-supplement", {
      name: "cases/supplement",
      data: { runId, query, round: round + 1 },
    });

    return { runId, round: round + 1, count: merged.length };
  }
);
