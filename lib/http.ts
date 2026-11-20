// 서버 창구(Route Handler)들이 함께 쓰는 작은 도구 모음

import { isLoggedIn } from "./session";
import type { ErrorResponse } from "./types";

/** 오류 응답을 만든다. */
export function fail(error: ErrorResponse["error"], message: string, status: number): Response {
  return Response.json({ error, message } satisfies ErrorResponse, { status });
}

/** 로그인하지 않았으면 거절 응답을, 로그인했으면 null을 돌려준다. */
export async function rejectIfLoggedOut(): Promise<Response | null> {
  return (await isLoggedIn()) ? null : fail("unauthorized", "로그인이 필요합니다.", 401);
}

/** 요청 본문을 JSON으로 읽는다. 읽을 수 없으면 null. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 제한 시간 안에 끝나지 않으면 TimeoutError를 던진다. */
export class TimeoutError extends Error {}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError("시간 초과")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
