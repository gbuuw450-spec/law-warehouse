// 본문 조회 창구: 사례 한 건의 결정문·판결문 전문을 돌려준다. (PLAN 5번, 14번)
// 전문은 법제처 API에서 받은 내용 그대로이며, AI가 고쳐 쓰지 않는다.

import { fail, readJson, rejectIfLoggedOut } from "@/lib/http";
import { getCaseBody, precedentOriginalUrl } from "@/lib/law-api";
import type { DetailResponse } from "@/lib/types";

export const maxDuration = 30;

export async function POST(request: Request) {
  const rejected = await rejectIfLoggedOut();
  if (rejected) return rejected;

  const body = await readJson(request);
  const kind = body?.kind;
  const id = body?.id;
  if ((kind !== "decision" && kind !== "precedent") || typeof id !== "string" || !/^\d+$/.test(id)) {
    return fail("bad_request", "잘못된 요청입니다.", 400);
  }

  try {
    const caseBody = await getCaseBody(kind, id);
    const response: DetailResponse = {
      text: caseBody?.fullText ?? null,
      // 판결은 법제처의 공개 페이지에서 원문을 볼 수 있다. (본문을 API로 받지 못한 경우에 안내)
      originalUrl: kind === "precedent" ? precedentOriginalUrl(id) : null,
    };
    return Response.json(response);
  } catch (error) {
    console.error("[본문 조회 실패]", error instanceof Error ? error.constructor.name : "알 수 없는 오류");
    return fail("failed", "자료를 불러오지 못했습니다.", 502);
  }
}
