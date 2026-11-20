// 검색 창구: 사실관계를 받아 쟁점, 법령 목록, 사례 목록을 돌려준다. (PLAN 10번)

import { fail, readJson, rejectIfLoggedOut, TimeoutError, withTimeout } from "@/lib/http";
import { findPersonalInfo } from "@/lib/privacy";
import { runSearch } from "@/lib/search";

// 배포 환경(Vercel)에서 이 창구가 실행될 수 있는 최대 시간(초)
export const maxDuration = 60;

const SEARCH_TIMEOUT_MS = 55_000; // 화면의 60초 제한보다 조금 짧게 잡아, 서버가 먼저 안내를 돌려주게 한다.

export async function POST(request: Request) {
  const rejected = await rejectIfLoggedOut();
  if (rejected) return rejected;

  const body = await readJson(request);
  const facts = typeof body?.facts === "string" ? body.facts.trim() : "";
  if (!facts) return fail("bad_request", "사실관계를 입력해 주세요.", 400);

  // 주민등록번호·사업자등록번호 형태가 있으면 OpenAI로 보내기 전에 멈춘다.
  const privacyWarning = findPersonalInfo(facts);
  if (privacyWarning) return fail("privacy", privacyWarning, 400);

  try {
    return Response.json(await withTimeout(runSearch(facts), SEARCH_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof TimeoutError) return fail("timeout", "자료를 불러오지 못했습니다.", 504);
    // 사실관계나 비밀 값이 로그에 남지 않도록 오류 종류만 기록한다.
    console.error("[검색 실패]", error instanceof Error ? error.constructor.name : "알 수 없는 오류");
    return fail("failed", "자료를 불러오지 못했습니다.", 502);
  }
}
