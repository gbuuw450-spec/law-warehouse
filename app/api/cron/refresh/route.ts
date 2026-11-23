// 새 결정 자동 추가 창구: 주 1회 Vercel이 자동으로 호출한다. (vercel.json의 crons)
// 최근에 새로 나온 조세심판원 결정례를 법제처에서 받아 저장소에 추가한다. AI를 쓰지 않아 OpenAI 요금이 들지 않는다.
// 아무나 호출하지 못하도록, Vercel이 함께 보내는 비밀 값(CRON_SECRET)이 맞을 때만 실행한다.

import { timingSafeEqual } from "node:crypto";
import { isStoreReady, refreshRecentDecisions } from "@/lib/decision-store";
import { fail, TimeoutError, withTimeout } from "@/lib/http";

export const maxDuration = 60;

const REFRESH_TIMEOUT_MS = 55_000;
const MAX_PAGES = 5; // 한 번에 최근 500건까지만 본다. (한 주에 나오는 결정은 이보다 훨씬 적다)

function isAllowed(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!isAllowed(request)) return fail("unauthorized", "허용되지 않은 요청입니다.", 401);
  if (!isStoreReady()) return fail("failed", "저장소가 설정되지 않았습니다.", 500);

  try {
    return Response.json(await withTimeout(refreshRecentDecisions(MAX_PAGES), REFRESH_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof TimeoutError) return fail("timeout", "시간 안에 끝내지 못했습니다. 다음 실행 때 이어서 받습니다.", 504);
    console.error("[새 결정 추가 실패]", error instanceof Error ? error.constructor.name : "알 수 없는 오류");
    return fail("failed", "새 결정을 추가하지 못했습니다.", 502);
  }
}
