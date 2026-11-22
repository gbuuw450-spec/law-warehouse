// 법제처 Open API 조회 코드 (PLAN 3~5번)
//
// 이 파일은 서버에서만 쓴다. 인증값(LAW_API_KEY)은 주소의 OC 항목으로 보내며,
// 주소나 응답 속 "상세링크"(인증값이 들어 있음)는 로그와 화면에 절대 내보내지 않는다.

import type { CaseItem, CaseKind } from "./types";

const BASE_URL = "https://www.law.go.kr/DRF";
const CALL_TIMEOUT_MS = 12_000; // 조회 한 번에 최대 12초

/** 법제처 조회가 실패했을 때 던지는 오류 */
export class LawApiError extends Error {}

type Json = Record<string, unknown>;

/** 법제처 API를 한 번 호출해 JSON을 돌려준다. */
async function callLawApi(path: "lawSearch.do" | "lawService.do", params: Record<string, string>): Promise<Json> {
  const key = process.env.LAW_API_KEY;
  if (!key) throw new LawApiError("LAW_API_KEY가 설정되지 않았습니다.");

  const url = new URL(`${BASE_URL}/${path}`);
  url.search = new URLSearchParams({ OC: key, type: "JSON", ...params }).toString();

  let body: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) throw new LawApiError(`법제처 서버 오류 (상태 코드 ${response.status})`);
    body = await response.text();
  } catch (error) {
    if (error instanceof LawApiError) throw error;
    // 원래 오류 문구에는 주소(인증값 포함)가 들어 있을 수 있어 그대로 전달하지 않는다.
    throw new LawApiError("법제처 API에 연결하지 못했습니다.");
  }

  try {
    return JSON.parse(body) as Json;
  } catch {
    throw new LawApiError("법제처 API가 예상과 다른 응답을 돌려줬습니다.");
  }
}

/** 값이 하나면 배열로 감싸고, 없으면 빈 배열로 만든다. (자료가 1건이면 배열이 아니라 객체로 온다) */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 목록 응답에서 자료 목록을 꺼낸다. */
function extractList(response: Json): Json[] {
  const outer = Object.values(response)[0];
  if (!outer || typeof outer !== "object") return [];
  const box = outer as Json;
  const list = box.law ?? box.prec ?? box.decc;
  return toArray(list as Json | Json[] | undefined).filter((item) => item && typeof item === "object");
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");

/** "2026.06.25" 또는 "20260625" 를 "20260625" 로 맞춘다. */
const normalizeDate = (value: unknown): string => text(value).replace(/\D/g, "").slice(0, 8);

/** HTML 줄바꿈과 태그를 글자로 바꾼다. */
function cleanHtml(value: unknown): string {
  return text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─────────────────────────────────────────────────────────────
// 사례 (조세심판원 결정례, 법원 판결) 검색
// ─────────────────────────────────────────────────────────────

/** 사건명 끝의 괄호에서 결과를 읽는다. 예: "…여부(기각)" → "기각" */
function resultFromTitle(title: string): string {
  const match = title.match(/\(([^()]{1,12})\)\s*$/);
  if (!match) return "";
  const word = match[1].trim();
  return /(인용|기각|각하|경정|취소|재조사|국승|국패|심리불속행|승소|패소)/.test(word) ? word : "";
}

/** 법제처 API가 본문을 제공하지 않는 자료 출처 */
const NO_BODY_SOURCES = ["국세법령정보시스템"];

/** 조세심판원 결정례를 검색한다. */
export async function searchDecisions(query: string, options: { bodySearch?: boolean; latestFirst?: boolean; count?: number } = {}): Promise<CaseItem[]> {
  const response = await callLawApi("lawSearch.do", {
    target: "ttSpecialDecc",
    query,
    display: String(options.count ?? 20),
    ...(options.bodySearch ? { search: "2" } : {}),
    ...(options.latestFirst ? { sort: "ddes" } : {}),
  });
  return extractList(response)
    .map((item): CaseItem => {
      const title = text(item["사건명"]);
      return {
        kind: "decision",
        id: text(item["특별행정심판재결례일련번호"]),
        caseNumber: text(item["청구번호"]),
        title,
        date: normalizeDate(item["의결일자"]),
        source: text(item["재결청"]) || "조세심판원",
        resultFromList: resultFromTitle(title),
      };
    })
    .filter((item) => item.id && item.caseNumber);
}

/** 법원 판결을 검색한다. byCaseNumber가 true면 검색어를 사건번호로 보고 찾는다. */
export async function searchPrecedents(
  query: string,
  options: { bodySearch?: boolean; latestFirst?: boolean; count?: number; byCaseNumber?: boolean } = {},
): Promise<CaseItem[]> {
  const response = await callLawApi("lawSearch.do", {
    target: "prec",
    ...(options.byCaseNumber ? { nb: query } : { query }),
    display: String(options.count ?? 20),
    ...(options.bodySearch ? { search: "2" } : {}),
    ...(options.latestFirst ? { sort: "ddes" } : {}),
  });
  return extractList(response)
    .map((item): CaseItem => {
      const title = text(item["사건명"]);
      return {
        kind: "precedent",
        id: text(item["판례일련번호"]),
        caseNumber: text(item["사건번호"]),
        title,
        date: normalizeDate(item["선고일자"]),
        source: text(item["데이터출처명"]) || text(item["법원명"]) || "법원",
        resultFromList: resultFromTitle(title),
      };
    })
    .filter((item) => item.id && item.caseNumber)
    // 국세법령정보시스템 출처 판결은 법제처 API가 본문을 주지 않아 요약과 본문보기를 할 수 없으므로 목록에서 뺀다.
    .filter((item) => !NO_BODY_SOURCES.some((source) => item.source.includes(source)));
}

// ─────────────────────────────────────────────────────────────
// 사례 본문 조회
// ─────────────────────────────────────────────────────────────

/** 사례 한 건의 본문 */
export interface CaseBody {
  /** 화면에 보여 줄 전문 */
  fullText: string;
  /** 주문 (결과를 읽어 낼 때 사용). 없으면 빈 글자 */
  order: string;
  /** API가 알려 준 결과 값 (예: "처분청 패소"). 없으면 빈 글자 */
  resultFromApi: string;
}

/** 본문 조회 응답에서 내용 묶음을 꺼낸다. 본문이 없으면 null (예: 국세법령정보시스템 출처 판결) */
function extractDetail(response: Json): Json | null {
  const outer = Object.values(response)[0];
  return outer && typeof outer === "object" && !Array.isArray(outer) ? (outer as Json) : null;
}

/** 제목과 내용을 "【제목】\n내용" 형태로 이어 붙인다. 내용이 없는 부분은 건너뛴다. */
function joinSections(sections: [string, string][]): string {
  return sections
    .filter(([, content]) => content)
    .map(([heading, content]) => `【${heading}】\n${content}`)
    .join("\n\n");
}

/** 사례 한 건의 본문을 가져온다. 법제처 API가 본문을 주지 않으면 null. */
export async function getCaseBody(kind: CaseKind, id: string): Promise<CaseBody | null> {
  if (!/^\d+$/.test(id)) throw new LawApiError("잘못된 자료 번호입니다.");

  if (kind === "decision") {
    const detail = extractDetail(await callLawApi("lawService.do", { target: "ttSpecialDecc", ID: id }));
    if (!detail) return null;
    const order = cleanHtml(detail["주문"]);
    const fullText = joinSections([
      ["사건명", cleanHtml(detail["사건명"])],
      ["세목", cleanHtml(detail["세목"])],
      ["주문", order],
      ["청구취지", cleanHtml(detail["청구취지"])],
      ["재결요지", cleanHtml(detail["재결요지"])],
      ["이유", cleanHtml(detail["이유"])],
      ["관련법령", cleanHtml(detail["관련법령"])],
    ]);
    // 결정례는 결과 항목이 따로 없고, 사건명 끝의 괄호에 결과가 적혀 있다.
    return fullText ? { fullText, order, resultFromApi: resultFromTitle(cleanHtml(detail["사건명"])) } : null;
  }

  const detail = extractDetail(await callLawApi("lawService.do", { target: "prec", ID: id }));
  if (!detail) return null;
  const content = cleanHtml(detail["판례내용"]);
  const orderMatch = content.match(/【주\s*문】([\s\S]*?)(?=【|$)/);
  // "판결", "결정" 같은 값은 결과가 아니라 문서 종류이므로 결과로 쓰지 않는다.
  const verdictType = text(detail["판결유형"]);
  const resultFromApi = /(승소|패소|국승|국패)/.test(verdictType) ? verdictType : "";
  const fullText = joinSections([
    ["사건명", cleanHtml(detail["사건명"])],
    ["판시사항", cleanHtml(detail["판시사항"])],
    ["판결요지", cleanHtml(detail["판결요지"])],
    ["참조조문", cleanHtml(detail["참조조문"])],
    ["참조판례", cleanHtml(detail["참조판례"])],
    ["판결문", content],
  ]);
  return fullText ? { fullText, order: orderMatch ? orderMatch[1].trim() : "", resultFromApi } : null;
}

/** 판결 원문을 볼 수 있는 공개 페이지 주소 (인증값이 들어 있지 않다). */
export function precedentOriginalUrl(id: string): string {
  return `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`;
}

// ─────────────────────────────────────────────────────────────
// 법령 조문 조회
// ─────────────────────────────────────────────────────────────

/** 조문 한 건 조회 결과 */
export interface ArticleResult {
  lawName: string;
  /** 예: 제55조(불복) */
  articleLabel: string;
  text: string;
  effectiveDate: string;
  historical: boolean;
}

interface LawVersion {
  mst: string;
  effectiveDate: string;
  historical: boolean;
}

/** 법령 이름 비교용: 띄어쓰기를 없앤다. */
const squash = (value: string) => value.replace(/\s+/g, "");

/** 현행 법령을 이름으로 찾는다. 이름이 정확히 같은 것만 인정한다. */
async function findCurrentLaw(lawName: string): Promise<LawVersion | null> {
  const list = extractList(await callLawApi("lawSearch.do", { target: "law", query: lawName, display: "20" }));
  const match = list.find((item) => squash(text(item["법령명한글"])) === squash(lawName));
  if (!match) return null;
  return { mst: text(match["법령일련번호"]), effectiveDate: normalizeDate(match["시행일자"]), historical: false };
}

/** 기준일에 시행 중이던 법령을 찾는다. 찾지 못하면 null. */
async function findLawAtDate(lawName: string, baseDate: string): Promise<LawVersion | null> {
  const list = extractList(await callLawApi("lawSearch.do", { target: "eflaw", query: lawName, display: "100" }));
  const versions = list
    .filter((item) => squash(text(item["법령명한글"])) === squash(lawName))
    .map((item) => ({ mst: text(item["법령일련번호"]), effectiveDate: normalizeDate(item["시행일자"]), announced: normalizeDate(item["공포일자"]) }))
    .filter((v) => v.mst && v.effectiveDate && v.effectiveDate <= baseDate)
    // 기준일 이전 중 가장 늦게 시행된 것, 시행일이 같으면 가장 늦게 공포된 것을 고른다.
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.announced.localeCompare(a.announced));
  const picked = versions[0];
  return picked ? { mst: picked.mst, effectiveDate: picked.effectiveDate, historical: true } : null;
}

/** 법제처 API에서 받은 법령 한 건 (조문 전체 포함) */
interface LoadedLaw {
  officialName: string;
  version: LawVersion;
  /** 장·절 제목을 뺀 실제 조문들 */
  units: Json[];
}

/** 한 번의 검색 안에서 받아 온 법령을 기억해 두는 곳 (같은 법령을 두 번 받지 않기 위함) */
export type LawCache = Map<string, Promise<LoadedLaw | null>>;

/** 법령 한 건의 조문 전체를 받아 온다. 법령을 찾지 못하면 null. */
async function loadLaw(lawName: string, baseDate: string | null): Promise<LoadedLaw | null> {
  const version = await resolveLawVersion(lawName, baseDate);
  if (!version || !version.mst) return null;

  const response = await callLawApi(
    "lawService.do",
    version.historical ? { target: "eflaw", MST: version.mst, efYd: version.effectiveDate } : { target: "law", MST: version.mst },
  );
  const law = extractDetail(response);
  if (!law) return null;

  const basic = (law["기본정보"] ?? {}) as Json;
  const units = toArray(((law["조문"] ?? {}) as Json)["조문단위"] as Json | Json[] | undefined)
    // 장·절 제목("전문")은 빼고 실제 조문만 남긴다.
    .filter((u) => u && typeof u === "object" && text(u["조문여부"]) === "조문");
  return { officialName: text(basic["법령명_한글"]) || lawName, version, units };
}

/** 조문 묶음에서 조 번호와 가지번호를 읽는다. 가지번호(제47조의5의 "5")는 따로 오거나 조문키("0047051")의 5~6번째 자리에 있다. */
function articleNumbers(unit: Json): { articleNo: number; branchNo: number } {
  return {
    articleNo: Number(text(unit["조문번호"])),
    branchNo: Number(text(unit["조문가지번호"]) || text(unit["조문키"]).slice(4, 6) || "0"),
  };
}

/** 제목 비교용: 띄어쓰기와 기호를 없앤다. */
const normalizeTitle = (value: string) => value.replace(/[\s·ㆍ・,.()\[\]「」『』'"]/g, "");

/** 두 제목이 얼마나 비슷한지 0~1로 돌려준다. (한쪽이 다른 쪽을 포함하면 1, 아니면 두 글자씩 겹치는 정도) */
function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return 0.9;
  const pairs = (s: string) => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));
  const xp = pairs(x);
  const yp = pairs(y);
  if (xp.length === 0 || yp.length === 0) return 0;
  const remaining = [...yp];
  let hits = 0;
  for (const p of xp) {
    const at = remaining.indexOf(p);
    if (at >= 0) {
      hits += 1;
      remaining.splice(at, 1);
    }
  }
  return (2 * hits) / (xp.length + yp.length);
}

/** 기준일이 있으면 그 시점의 법령을, 없거나 못 찾으면 현행 법령을 찾는다. */
async function resolveLawVersion(lawName: string, baseDate: string | null): Promise<LawVersion | null> {
  if (baseDate) {
    try {
      const atDate = await findLawAtDate(lawName, baseDate);
      if (atDate) return atDate;
    } catch {
      // 과거 조문을 못 찾으면 아래에서 현행으로 대신한다.
    }
  }
  return findCurrentLaw(lawName);
}

/** 조문 묶음에서 글자를 순서대로 모은다. (조문 → 항 → 호 → 목) */
function collectArticleText(unit: Json): string {
  const lines: string[] = [];
  const add = (value: unknown) => {
    for (const part of toArray(value as unknown)) {
      if (typeof part === "string") {
        if (part.trim()) lines.push(part.trim());
      } else if (Array.isArray(part)) {
        add(part);
      }
    }
  };
  const walk = (node: Json, contentKey: string, childKeys: string[]) => {
    add(node[contentKey]);
    const [childKey, ...rest] = childKeys;
    if (!childKey) return;
    for (const child of toArray(node[childKey] as Json | Json[] | undefined)) {
      if (child && typeof child === "object") walk(child, `${childKey}내용`, rest);
    }
  };
  walk(unit, "조문내용", ["항", "호", "목"]);
  add(unit["조문참고자료"]);
  return lines.join("\n");
}

const NUMBER_MATCH_MIN = 0.5; // 번호로 찾은 조문의 제목이 이 정도는 비슷해야 맞는 조문으로 본다.
const TITLE_MATCH_MIN = 0.7; // 번호가 틀렸을 때 제목으로 다시 찾으려면 이 정도는 비슷해야 한다.

/**
 * 법령 이름, 조문 번호, 조문 제목으로 조문 한 건을 가져온다.
 * - baseDate(YYYYMMDD)가 있으면 그 시점에 시행 중이던 조문을 먼저 찾고, 없으면 현행 조문으로 대신한다.
 * - AI가 기억하는 조문 번호는 법 개정으로 바뀌었을 수 있다. 그래서 번호로 찾은 조문의 제목이 기대한 제목과 다르면,
 *   같은 법령에서 제목이 맞는 조문을 다시 찾는다. (예: 번호는 제81조라고 했지만 실제로는 제80조의2)
 * - 번호도 제목도 확인되지 않으면 null을 돌려준다. (지어내거나 잘못 기억한 조문을 걸러내는 장치)
 */
export async function getArticle(
  lawName: string,
  articleNo: number,
  branchNo: number,
  expectedTitle: string,
  baseDate: string | null,
  cache: LawCache = new Map(),
): Promise<ArticleResult | null> {
  if (!Number.isInteger(articleNo) || articleNo < 1 || articleNo > 9999) return null;
  if (!Number.isInteger(branchNo) || branchNo < 0 || branchNo > 99) return null;

  // 같은 법령의 조문을 여러 개 찾을 때 법령을 한 번만 받아 오도록 기억해 둔다.
  const cacheKey = `${squash(lawName)}|${baseDate ?? ""}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = loadLaw(lawName, baseDate);
    cache.set(cacheKey, pending);
  }
  const law = await pending;
  if (!law) return null;

  const byNumber = law.units.find((u) => {
    const n = articleNumbers(u);
    return n.articleNo === articleNo && n.branchNo === branchNo;
  });

  let unit: Json | undefined;
  if (!expectedTitle) {
    unit = byNumber; // 기대한 제목이 없으면 번호로만 확인한다.
  } else if (byNumber && titleSimilarity(text(byNumber["조문제목"]), expectedTitle) >= NUMBER_MATCH_MIN) {
    unit = byNumber;
  } else {
    // 번호가 틀렸을 수 있으므로 제목이 가장 비슷한 조문을 찾는다. 비슷한 정도가 같으면 번호가 가까운 쪽을 고른다.
    let best: { unit: Json; score: number; distance: number } | null = null;
    for (const candidate of law.units) {
      const score = titleSimilarity(text(candidate["조문제목"]), expectedTitle);
      if (score < TITLE_MATCH_MIN) continue;
      const distance = Math.abs(articleNumbers(candidate).articleNo - articleNo);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { unit: candidate, score, distance };
    }
    unit = best?.unit;
  }
  if (!unit) return null;

  const body = collectArticleText(unit);
  if (!body) return null;

  const actual = articleNumbers(unit);
  const title = text(unit["조문제목"]);
  const label = `제${actual.articleNo}조${actual.branchNo ? `의${actual.branchNo}` : ""}${title ? `(${title})` : ""}`;
  return {
    lawName: law.officialName,
    articleLabel: label,
    text: body,
    effectiveDate: normalizeDate(unit["조문시행일자"]) || law.version.effectiveDate,
    historical: law.version.historical,
  };
}
