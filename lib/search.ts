// 검색 한 번으로 묶기 (PLAN 9~10번)
//
// 화면에서 고른 토글에 해당하는 쪽만 검색한다.
//   법령 범위:        사실관계 → (AI 분석) → 법제처 API에서 법령 조문 확인
//   선결정례 등 범위: 사실관계 → (AI 분석) → 법제처 API에서 사례 후보 조회 → AI가 줄 세움
// AI 분석 결과(검색 계획)는 첫 검색 때 한 번만 만들고, 화면이 다른 토글을 검색할 때 다시 보내 준다.
// 사례 요약은 여기서 만들지 않는다. 화면이 5건씩 따로 요청한다. (lib/summarize.ts)

import { analyzeFacts, rankCases } from "./ai";
import { keepLatestOfSameDecisions } from "./dedupe";
import { describeWantedResult, matchesWantedResult, outcomeFromDecisionOrder, outcomeFromVerdictType } from "./result-filter";
import { getArticle, getCaseBody, searchDecisions, searchPrecedents, LawApiError, type LawCache } from "./law-api";
import type { CaseItem, CaseKind, LawArticle, LawCandidate, LawResult, SearchPlan, SearchResponse, SearchScope, WantedResult } from "./types";

const MAX_LAWS = 10; // 법령은 최대 10개
const MAX_CASES = 20; // 선결정례와 법원 판결은 각각 최대 20건
const MAX_CANDIDATES = 110; // AI에게 보여 줄 사례 후보 수 한도
const MAX_COLLECTED = 170; // 같은 결정을 묶기 전에 모아 둘 후보 수 한도
const RESULT_CHECK_AT_ONCE = 12; // 결과(주문)를 확인할 때 동시에 조회하는 건수
const RESULT_CHECK_LIMIT_MS = 15_000; // 결과 확인에 쓰는 시간 한도

const formatDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}.`;

/** AI가 제안한 법령 후보를 법제처 API로 확인해, 실제로 조회된 조문만 남긴다. */
async function verifyLaws(plan: SearchPlan): Promise<LawArticle[]> {
  if (plan.lawCandidates.length === 0) return [];

  const cache: LawCache = new Map();
  const settled = await Promise.allSettled(
    plan.lawCandidates.map((c) => getArticle(c.lawName, c.articleNo, c.branchNo, c.title, plan.baseDate, cache)),
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
    laws.push({ ...article, reason: plan.lawCandidates[index].reason });
  });
  return laws.slice(0, MAX_LAWS);
}

/**
 * 결과 조건(인용만, 기각만)에 맞는 사례만 남긴다.
 * 결과는 법제처 목록에 없어서 사례마다 본문을 열어 주문을 읽는다. AI를 쓰지 않으므로 요금은 들지 않는다.
 * 한꺼번에 너무 많이 조회하지 않도록 몇 건씩 나눠 조회하고, 정해진 시간 안에 확인하지 못한 사례는 뺀다.
 */
async function keepWantedResult(items: CaseItem[], wanted: WantedResult): Promise<CaseItem[]> {
  const deadline = Date.now() + RESULT_CHECK_LIMIT_MS;
  const keep = new Array<boolean>(items.length).fill(false);
  let next = 0;
  let failed = 0;

  async function worker() {
    while (next < items.length && Date.now() < deadline) {
      const index = next;
      next += 1;
      const item = items[index];
      try {
        const body = await getCaseBody(item.kind, item.id);
        if (!body) continue;
        const outcome = item.kind === "decision" ? outcomeFromDecisionOrder(body.order) : outcomeFromVerdictType(body.resultFromApi);
        keep[index] = matchesWantedResult(outcome, wanted);
      } catch {
        failed += 1; // 조회하지 못한 사례는 결과를 알 수 없으므로 뺀다.
      }
    }
  }
  await Promise.all(Array.from({ length: RESULT_CHECK_AT_ONCE }, worker));

  // 하나도 조회하지 못했다면 법제처 API에 문제가 있는 것이므로 오류로 알린다.
  if (items.length > 0 && failed === items.length) throw new LawApiError("사례의 결과를 조회하지 못했습니다.");
  return items.filter((_, index) => keep[index]);
}

/** 여러 검색어로 사례 후보를 모은 뒤, AI가 관련성 순으로 줄 세운다. */
async function findCases(facts: string, plan: SearchPlan, kind: CaseKind, wantedResult: WantedResult): Promise<CaseItem[]> {
  if (plan.keywords.length === 0) return [];

  // 고른 토글의 종류(조세심판원 결정례 또는 법원 판결)만 검색어마다 조회한다. 앞쪽 검색어 3개는 본문 검색도 함께 한다.
  // 후보는 항상 최근 날짜 순으로 받아, 최근 사례가 후보에서 빠지지 않게 한다.
  // 판결은 본문이 없는 출처를 뺀 뒤에도 후보가 남도록 넉넉히 받는다.
  const searches: Promise<CaseItem[]>[] = [];
  plan.keywords.forEach((keyword, index) => {
    if (kind === "decision") {
      searches.push(searchDecisions(keyword, { latestFirst: true, count: 40 }));
      if (index < 3) searches.push(searchDecisions(keyword, { bodySearch: true, latestFirst: true, count: 20 }));
    } else {
      searches.push(searchPrecedents(keyword, { latestFirst: true, count: 60 }));
      if (index < 3) searches.push(searchPrecedents(keyword, { bodySearch: true, latestFirst: true, count: 40 }));
    }
  });
  const settled = await Promise.allSettled(searches);
  if (settled.every((s) => s.status === "rejected")) throw new LawApiError("사례를 조회하지 못했습니다.");

  // 검색별 결과를 한 건씩 번갈아 가며 모아, 어느 한 검색어의 결과만 남지 않게 한다. 겹치는 것은 하나로 합친다.
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []));
  const collected: CaseItem[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let row = 0; row < longest && collected.length < MAX_COLLECTED; row += 1) {
    for (const list of lists) {
      const item = list[row];
      if (!item) continue;
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
      if (collected.length >= MAX_COLLECTED) break;
    }
  }
  // 같은 결정이 여러 건이면 가장 최근 것 한 건만 남긴 뒤, AI에게 보여 줄 만큼만 추린다.
  // 화면에서 인용 또는 기각을 골랐으면, 주문을 읽어 그 결과의 사례만 먼저 남긴다. (AI에게 보여 주기 전에 거른다)
  // 같은 결정 묶기보다 먼저 해야, 사건명이 같은 기각 사례 때문에 인용 사례가 빠지는 일이 없다.
  const wanted = wantedResult ? await keepWantedResult(collected, wantedResult) : collected;
  const candidates = keepLatestOfSameDecisions(wanted).slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];

  const order = await rankCases(facts, plan.issue, candidates, plan.latestFirst);
  const ranked = order.map((index) => candidates[index]).slice(0, MAX_CASES);

  // "가장 최근" 조건이 있으면, 관련 있다고 고른 사례들을 최근 날짜 순으로 보여 준다.
  if (plan.latestFirst) ranked.sort((a, b) => b.date.localeCompare(a.date));
  return ranked;
}

/** 적용 시점 표시와 안내 문구를 만든다. */
function describeBasis(plan: SearchPlan, laws: LawArticle[]): Pick<LawResult, "basisLabel" | "notice"> {
  const historicalCount = laws.filter((l) => l.historical).length;

  if (plan.dateStatus === "clear" && plan.baseDate && historicalCount > 0) {
    const notice =
      historicalCount < laws.length
        ? "일부 조문은 입력하신 시점의 내용을 조회하지 못해 현행 조문으로 표시했습니다. 조문마다 표시된 시행일을 확인해 주세요."
        : null;
    return { basisLabel: `${formatDate(plan.baseDate)} 기준`, notice };
  }
  if (plan.dateStatus === "clear") {
    return { basisLabel: "현행 법령 기준", notice: laws.length > 0 ? "입력하신 시점의 조문을 조회하지 못해 현행 조문으로 표시했습니다." : null };
  }
  return {
    basisLabel: "현행 법령 기준",
    notice:
      plan.dateStatus === "unclear"
        ? "시점이 명확하지 않아 현행 법령 기준으로 표시했습니다. 거래·과세 시점(연도)을 하나로 적어 주시면 그 시점의 조문을 찾습니다."
        : "사실관계에 시점이 없어 현행 법령 기준으로 표시했습니다. 거래·과세 시점(연도)을 적어 주시면 그 시점의 조문을 찾습니다.",
  };
}

const asText = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * 화면이 다시 보내 준 검색 계획을 점검한다. 모양이 맞지 않으면 null을 돌려주고, 그러면 AI 분석을 새로 한다.
 * 계획에 든 값은 검색어와 조문 후보일 뿐이고, 화면에 나가는 사건번호·조문은 여전히 법제처 API에서 조회한 것만 쓴다.
 */
export function sanitizePlan(raw: unknown): SearchPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const plan = raw as Record<string, unknown>;

  const keywords = (Array.isArray(plan.keywords) ? plan.keywords : [])
    .map((k) => asText(k, 30))
    .filter((k) => k.length >= 2)
    .slice(0, 10);

  const lawCandidates: LawCandidate[] = [];
  for (const item of Array.isArray(plan.lawCandidates) ? plan.lawCandidates.slice(0, 12) : []) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const lawName = asText(c.lawName, 80);
    const articleNo = Number(c.articleNo);
    const branchNo = Number(c.branchNo ?? 0) || 0;
    if (!lawName || !Number.isInteger(articleNo) || articleNo < 1 || !Number.isInteger(branchNo) || branchNo < 0) continue;
    lawCandidates.push({ lawName, articleNo, branchNo, title: asText(c.title, 60), reason: asText(c.reason, 300) });
  }

  const baseDate = asText(plan.baseDate, 8);
  const dateIsValid = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(baseDate);
  const dateStatus = plan.dateStatus === "clear" && dateIsValid ? "clear" : plan.dateStatus === "unclear" ? "unclear" : "none";

  const issue = asText(plan.issue, 600);
  if (!issue && keywords.length === 0 && lawCandidates.length === 0) return null;

  return {
    isTax: plan.isTax !== false,
    issue,
    keywords,
    lawCandidates,
    baseDate: dateStatus === "clear" ? baseDate : null,
    dateStatus,
    latestFirst: plan.latestFirst === true,  };
}

/**
 * 고른 범위(법령, 선결정례, 법원 판결)만 검색한다. 검색 계획이 없으면 AI 분석부터 한다.
 * wantedResult는 선결정례 토글에서 고른 결과 조건(인용, 기각)이며, 선결정례 범위에만 쓴다.
 */
export async function runSearch(facts: string, scope: SearchScope, givenPlan: SearchPlan | null, wantedResult: WantedResult = null): Promise<SearchResponse> {
  const plan = givenPlan ?? (await analyzeFacts(facts));

  // PRD: 조세 분야만 다룬다.
  if (!plan.isTax) {
    return { issue: "", outOfScope: "법률창고는 조세 분야만 다룹니다. 세무 관련 사실관계를 적어 주세요.", plan };
  }

  if (scope === "law") {
    const laws = await verifyLaws(plan);
    return { issue: plan.issue, outOfScope: null, plan, lawResult: { ...describeBasis(plan, laws), laws } };
  }
  if (scope === "precedent") {
    return { issue: plan.issue, outOfScope: null, plan, cases: await findCases(facts, plan, "precedent", null), caseNotice: null };
  }
  return {
    issue: plan.issue,
    outOfScope: null,
    plan,
    cases: await findCases(facts, plan, "decision", wantedResult),
    caseNotice: describeWantedResult(wantedResult),
  };
}
