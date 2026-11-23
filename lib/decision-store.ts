// 결정례 저장소 (Supabase)
//
// 법제처 API는 조세심판원 결정례를 사건명으로만 찾아 준다. (본문 검색이 실제로는 동작하지 않는다)
// 그래서 사건명이 "이 건 심판청구가 적법한지 여부"처럼 일반적인 결정은 주제로 찾을 수 없다.
// 이를 메우려고 결정례 전체의 사건명·재결요지·주문을 Supabase 표에 받아 두고, 여기서 직접 낱말을 찾는다.
//
// - 저장소에는 법제처에 공개된 결정례 정보만 있다. 사용자가 입력한 사실관계나 검색 결과는 저장하지 않는다.
// - 본문(이유)은 저장하지 않는다. 화면에 보여 줄 본문은 그때그때 법제처에서 가져온다.
// - 이 파일은 서버에서만 쓴다. 저장소 키는 로그와 화면에 내보내지 않는다.

import { getDecisionIndexRow, listLatestDecisions } from "./law-api";
import { outcomeFromDecisionOrder } from "./result-filter";
import type { CaseItem, WantedResult } from "./types";

const STORE_TIMEOUT_MS = 10_000;

/** 저장소 호출이 실패했을 때 던지는 오류 */
export class StoreError extends Error {}

/** 저장소 주소와 키가 설정되어 있는지. 없으면 예전처럼 법제처 검색만 쓴다. */
export function isStoreReady(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function callStore(pathAndQuery: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StoreError("저장소가 설정되지 않았습니다.");

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      method: init.method ?? "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // 원래 오류 문구는 그대로 전달하지 않는다. (주소나 키가 섞여 나올 가능성을 막기 위함)
    throw new StoreError("저장소에 연결하지 못했습니다.");
  }
  if (!response.ok) throw new StoreError(`저장소 오류 (상태 코드 ${response.status})`);
  return response;
}

const asText = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

/**
 * 검색어 중 하나라도 사건명이나 재결요지에 들어 있는 결정례를 저장소에서 찾는다.
 * 맞는 검색어가 많은 것을 위에, 같으면 최근 것을 위에 둔 순서로 돌려준다.
 * wanted가 있으면 그 결과(인용 또는 기각)의 결정례만 찾는다.
 */
export async function searchStoredDecisions(keywords: string[], wanted: WantedResult, maxRows: number): Promise<CaseItem[]> {
  // 검색어 안의 %, _ 는 "아무 글자"로 해석되므로 없앤다.
  const cleaned = keywords.map((k) => k.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim()).filter((k) => k.length >= 2);
  if (cleaned.length === 0) return [];

  // 검색어마다 따로 찾아(최근 순으로 PER_KEYWORD건씩) 합친다.
  // 한 번에 모든 검색어를 찾게 하면 "처분"처럼 흔한 낱말 때문에 저장소의 시간 제한에 걸린다.
  const settled = await Promise.allSettled(cleaned.map((keyword) => searchOneKeyword(keyword, wanted)));
  if (settled.every((s) => s.status === "rejected")) throw new StoreError("저장소에서 결정례를 찾지 못했습니다.");

  // 여러 검색어에 걸린 결정일수록 점수를 높게 준다. 앞쪽 검색어 3개는 더 중요하므로 2배,
  // 드문 검색어(찾은 건수가 한도보다 적은 것)는 그 결정을 콕 집어 주는 낱말이므로 2배로 친다.
  const found = new Map<string, { item: CaseItem; score: number }>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const weight = (index < 3 ? 2 : 1) * (result.value.length < PER_KEYWORD ? 2 : 1);
    for (const item of result.value) {
      const entry = found.get(item.id);
      if (entry) entry.score += weight;
      else found.set(item.id, { item, score: weight });
    }
  });

  return [...found.values()]
    .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date))
    .slice(0, maxRows)
    .map((entry) => entry.item);
}

const PER_KEYWORD = 60; // 검색어 하나에서 받아 오는 결정례 수 한도

/** 검색어 하나가 사건명이나 재결요지에 들어 있는 결정례를 최근 순으로 찾는다. 띄어 쓴 낱말은 모두 들어 있어야 한다. */
async function searchOneKeyword(keyword: string, wanted: WantedResult): Promise<CaseItem[]> {
  const words = keyword.split(" ").filter((word) => word.length > 0);
  const params = new URLSearchParams({ select: "id,case_no,decided,title,gist", order: "decided.desc", limit: String(PER_KEYWORD) });
  // 저장소 주소 규칙에서 쉼표, 괄호, 별표는 특별한 뜻이 있으므로 낱말에서 없앤다.
  const safe = (word: string) => word.replace(/[,()*"]/g, "");
  if (words.length === 1) params.set("search_text", `ilike.*${safe(words[0])}*`);
  else params.set("and", `(${words.map((word) => `search_text.ilike.*${safe(word)}*`).join(",")})`);
  if (wanted) params.set("outcome", `eq.${wanted}`);

  const response = await callStore(`tax_decisions?${params.toString()}`);
  const rows: unknown = await response.json().catch(() => null);
  if (!Array.isArray(rows)) throw new StoreError("저장소가 예상과 다른 응답을 돌려줬습니다.");

  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row): CaseItem => ({
      kind: "decision",
      id: asText(row.id),
      caseNumber: asText(row.case_no),
      title: asText(row.title),
      date: asText(row.decided),
      source: "조세심판원",
      resultFromList: "",
      gist: asText(row.gist),
    }))
    .filter((item) => /^\d+$/.test(item.id) && item.caseNumber);
}

/**
 * 최근에 새로 나온 결정례를 법제처에서 받아 저장소에 추가한다. (주 1회 자동 실행)
 * 최근 것부터 한 쪽씩 보다가, 한 쪽 전체가 이미 저장소에 있으면 멈춘다. AI를 쓰지 않는다.
 */
export async function refreshRecentDecisions(maxPages: number): Promise<{ pages: number; added: number }> {
  let added = 0;
  let pages = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const list = await listLatestDecisions(page);
    if (list.length === 0) break;
    pages = page;

    const existingResponse = await callStore(`tax_decisions?select=id&id=in.(${list.map((item) => item.id).join(",")})`);
    const existing = new Set(((await existingResponse.json()) as { id: number }[]).map((row) => String(row.id)));
    const missing = list.filter((item) => !existing.has(item.id));
    if (missing.length === 0) break; // 이 쪽은 모두 이미 있으므로, 더 오래된 쪽도 이미 있다.

    // 한꺼번에 너무 많이 조회하지 않도록 10건씩 나눠 조회한다.
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; start < missing.length; start += 10) {
      const settled = await Promise.allSettled(missing.slice(start, start + 10).map((item) => getDecisionIndexRow(item)));
      for (const result of settled) {
        if (result.status !== "fulfilled" || !result.value) continue;
        const row = result.value;
        rows.push({
          id: Number(row.id),
          case_no: row.caseNumber,
          decided: row.date,
          tax: row.tax,
          title: row.title,
          gist: row.gist,
          order_text: row.order,
          outcome: outcomeFromDecisionOrder(row.order),
        });
      }
    }
    if (rows.length > 0) {
      await callStore("tax_decisions?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: rows });
      added += rows.length;
    }
  }
  return { pages, added };
}
