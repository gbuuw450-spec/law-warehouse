// 사례 요약 만들기 (PLAN 8번)
//
// 사건번호와 본문은 법제처 API에서 다시 조회한 값을 쓰고, AI는 그 본문을 요약만 한다.

import { summarizeCase } from "./ai";
import { getCaseBody } from "./law-api";
import type { CaseKind, CaseSummary } from "./types";

/** 사례 한 건의 요약과 결과를 만든다. */
export async function buildSummary(kind: CaseKind, id: string): Promise<CaseSummary> {
  const body = await getCaseBody(kind, id);

  // 법제처 API가 본문을 주지 않는 자료(국세법령정보시스템 출처 판결 등)는 요약하지 않는다.
  if (!body) return { kind, id, summary: null, result: "결과 미확인", hasBody: false };

  // 주문과 요지가 앞에 오도록 구성된 전문을 AI에게 준다.
  const ai = await summarizeCase(kind, "", body.fullText);

  // 결과는 API 값을 우선하고, 없을 때만 AI가 주문을 읽고 분류한 값을 쓴다.
  return { kind, id, summary: ai.summary, result: body.resultFromApi || ai.result, hasBody: true };
}
