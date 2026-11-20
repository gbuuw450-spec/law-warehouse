// 요약 창구: 사례 번호를 최대 5개 받아 각 사례의 요약과 결과를 돌려준다. (PLAN 8번, 13번)
// 처음 검색 직후의 5건과, `더보기`를 누를 때의 다음 5건에 모두 쓰인다.

import { fail, readJson, rejectIfLoggedOut, TimeoutError, withTimeout } from "@/lib/http";
import { buildSummary } from "@/lib/summarize";
import type { CaseKind, CaseSummary } from "@/lib/types";

export const maxDuration = 60;

const SUMMARY_TIMEOUT_MS = 45_000;
const MAX_ITEMS = 5;

export async function POST(request: Request) {
  const rejected = await rejectIfLoggedOut();
  if (rejected) return rejected;

  const body = await readJson(request);
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const items: { kind: CaseKind; id: string }[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const { kind, id } = raw as Record<string, unknown>;
    if ((kind === "decision" || kind === "precedent") && typeof id === "string" && /^\d+$/.test(id)) {
      items.push({ kind, id });
    }
  }
  if (items.length === 0) return fail("bad_request", "요약할 사례가 없습니다.", 400);

  try {
    const settled = await withTimeout(Promise.allSettled(items.map((item) => buildSummary(item.kind, item.id))), SUMMARY_TIMEOUT_MS);
    if (settled.every((s) => s.status === "rejected")) return fail("failed", "자료를 불러오지 못했습니다.", 502);

    // 일부만 실패했으면, 실패한 사례는 요약 없이 돌려준다. (화면에서 "요약을 만들지 못했습니다"로 표시)
    const summaries: CaseSummary[] = settled.map((s, index) =>
      s.status === "fulfilled" ? s.value : { ...items[index], summary: null, result: "결과 미확인", hasBody: true },
    );
    return Response.json({ summaries });
  } catch (error) {
    if (error instanceof TimeoutError) return fail("timeout", "자료를 불러오지 못했습니다.", 504);
    console.error("[요약 실패]", error instanceof Error ? error.constructor.name : "알 수 없는 오류");
    return fail("failed", "자료를 불러오지 못했습니다.", 502);
  }
}
