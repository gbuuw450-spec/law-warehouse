// 검색 한 번으로 묶기 (PLAN 9~10번)
//
// 흐름: 사실관계 → AI가 쟁점·검색어·법령 후보·시점을 뽑음
//       → 법제처 API에서 법령 조문 확인 + 사례 후보 조회 (동시에)
//       → AI가 사례 후보를 줄 세움 → 결과를 돌려줌
// 사례 요약은 여기서 만들지 않는다. 화면이 5건씩 따로 요청한다. (lib/summarize.ts)

import { analyzeFacts, rankCases, type Analysis } from "./ai";
import { getArticle, searchDecisions, searchPrecedents, LawApiError, type LawVersionCache } from "./law-api";
import type { CaseItem, LawArticle, SearchResponse } from "./types";

const MAX_LAWS = 10; // 법령은 최대 10개
const MAX_CASES = 20; // 선결정례 등은 최대 20건
const MAX_CANDIDATES = 110; // AI에게 보여 줄 사례 후보 수 한도

const formatDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}.`;

/** AI가 제안한 법령 후보를 법제처 API로 확인해, 실제로 조회된 조문만 남긴다. */
async function verifyLaws(analysis: Analysis): Promise<LawArticle[]> {
  if (analysis.lawCandidates.length === 0) return [];

  const cache: LawVersionCache = new Map();
  const settled = await Promise.allSettled(
    analysis.lawCandidates.map((c) => getArticle(c.lawName, c.articleNo, c.branchNo, analysis.baseDate, cache)),
  );
  // 모든 조회가 실패했다면 법제처 API에 문제가 있는 것이므로 오류로 알린다.
  if (settled.every((s) => s.status === "rejected")) throw new LawApiError("법령을 조회하지 못했습니다.");

  const laws: LawArticle[] = [];
  const seen = new Set<string>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return; // 확인되지 않은 조문은 버린다.
    const article = result.value;
    const key = `${article.lawName}|${article.articleLabel}`;
    if (seen.has(key)) return;
    seen.add(key);
    laws.push({ ...article, reason: analysis.lawCandidates[index].reason });
  });
  return laws.slice(0, MAX_LAWS);
}

/** 여러 검색어로 사례 후보를 모은 뒤, AI가 관련성 순으로 줄 세운다. */
async function findCases(facts: string, analysis: Analysis): Promise<CaseItem[]> {
  if (analysis.keywords.length === 0) return [];
  const latestFirst = analysis.latestFirst;

  // 검색어마다 결정례와 판결을 동시에 조회한다. 앞쪽 검색어 3개는 본문 검색도 함께 한다.
  // 후보는 항상 최근 날짜 순으로 받아, 최근 사례가 후보에서 빠지지 않게 한다.
  // 판결은 본문이 없는 출처를 뺀 뒤에도 후보가 남도록 넉넉히 받는다.
  const searches: Promise<CaseItem[]>[] = [];
  analysis.keywords.forEach((keyword, index) => {
    searches.push(searchDecisions(keyword, { latestFirst: true, count: 30 }));
    searches.push(searchPrecedents(keyword, { latestFirst: true, count: 60 }));
    if (index < 3) {
      searches.push(searchDecisions(keyword, { bodySearch: true, latestFirst: true, count: 15 }));
      searches.push(searchPrecedents(keyword, { bodySearch: true, latestFirst: true, count: 40 }));
    }
  });
  const settled = await Promise.allSettled(searches);
  if (settled.every((s) => s.status === "rejected")) throw new LawApiError("사례를 조회하지 못했습니다.");

  // 검색별 결과를 한 건씩 번갈아 가며 모아, 어느 한 검색어의 결과만 남지 않게 한다. 겹치는 것은 하나로 합친다.
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const candidates: CaseItem[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let row = 0; row < longest && candidates.length < MAX_CANDIDATES; row += 1) {
    for (const list of lists) {
      const item = list[row];
      if (!item) continue;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }
  if (candidates.length === 0) return [];

  const order = await rankCases(facts, analysis.issue, candidates, latestFirst);
  const ranked = order.map((index) => candidates[index]).slice(0, MAX_CASES);

  // "가장 최근" 조건이 있으면, 관련 있다고 고른 사례들을 최근 날짜 순으로 보여 준다.
  if (latestFirst) ranked.sort((a, b) => b.date.localeCompare(a.date));
  return ranked;
}

/** 적용 시점 표시와 안내 문구를 만든다. */
function describeBasis(analysis: Analysis, laws: LawArticle[]): { basisLabel: string; notice: string | null } {
  const historicalCount = laws.filter((l) => l.historical).length;

  if (analysis.dateStatus === "clear" && analysis.baseDate && historicalCount > 0) {
    const notice =
      historicalCount < laws.length
        ? "일부 조문은 입력하신 시점의 내용을 조회하지 못해 현행 조문으로 표시했습니다. 조문마다 표시된 시행일을 확인해 주세요."
        : null;
    return { basisLabel: `${formatDate(analysis.baseDate)} 기준`, notice };
  }
  if (analysis.dateStatus === "clear") {
    return { basisLabel: "현행 법령 기준", notice: laws.length > 0 ? "입력하신 시점의 조문을 조회하지 못해 현행 조문으로 표시했습니다." : null };
  }
  return {
    basisLabel: "현행 법령 기준",
    notice:
      analysis.dateStatus === "unclear"
        ? "시점이 명확하지 않아 현행 법령 기준으로 표시했습니다. 거래·과세 시점(연도)을 하나로 적어 주시면 그 시점의 조문을 찾습니다."
        : "사실관계에 시점이 없어 현행 법령 기준으로 표시했습니다. 거래·과세 시점(연도)을 적어 주시면 그 시점의 조문을 찾습니다.",
  };
}

/** 검색 한 번을 처음부터 끝까지 실행한다. */
export async function runSearch(facts: string): Promise<SearchResponse> {
  const analysis = await analyzeFacts(facts);

  // PRD: 조세 분야만 다룬다.
  if (!analysis.isTax) {
    return {
      issue: "",
      basisLabel: "",
      notice: "법률창고는 조세 분야만 다룹니다. 세무 관련 사실관계를 적어 주세요.",
      laws: [],
      cases: [],
    };
  }

  const [laws, cases] = await Promise.all([verifyLaws(analysis), findCases(facts, analysis)]);
  return { issue: analysis.issue, ...describeBasis(analysis, laws), laws, cases };
}
