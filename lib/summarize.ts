// 사례 요약 만들기 (PLAN 8번)
//
// 사건번호와 본문은 법제처 API에서 다시 조회한 값을 쓰고, AI는 그 본문을 요약만 한다.

import { summarizeCase } from "./ai";
import { pickSummaryText } from "./judgment";
import { getCaseBody } from "./law-api";
import type { CaseKind, CaseSummary } from "./types";

/** 사례 한 건의 요약과 결과를 만든다. */
export async function buildSummary(kind: CaseKind, id: string): Promise<CaseSummary> {
  const body = await getCaseBody(kind, id);

  // 법제처 API가 본문을 주지 않는 자료(국세법령정보시스템 출처 판결 등)는 요약하지 않는다.
  if (!body) return { kind, id, summary: null, result: "결과 미확인", hasBody: false };

  // 전문을 앞에서부터 자르면 맨 뒤쪽의 판단 부분이 빠진다. 앞머리(주문·요지)와 개요, 판단 부분을 골라 AI에게 준다.
  const ai = await summarizeCase(kind, "", pickSummaryText(kind, body.fullText));

  // 결과는 API 값을 우선하고, 없을 때만 AI가 주문을 읽고 분류한 값을 쓴다.
  return { kind, id, summary: ai.summary, result: body.resultFromApi || ai.result, hasBody: true };
}
