// 로그인 상태 관리 (PLAN 16번)
//
// 데이터베이스가 없으므로, 서버가 서명한 쿠키로 "로그인했음"과 "몇 번 틀렸음"을 기억한다.
// 서명은 .env의 APP_PASSWORD에서 만든 비밀 값으로 하므로, 브라우저에서 쿠키를 고쳐도 통과할 수 없다.
// 비밀번호 값은 로그, 화면, 쿠키 어디에도 그대로 넣지 않는다.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "lc_session";
const FAIL_COOKIE = "lc_fail";

export const SESSION_DAYS = 7; // 로그인 유지 기간
export const MAX_FAILS = 5; // 이 횟수만큼 틀리면 잠근다
export const LOCK_MINUTES = 10; // 잠그는 시간

function secret(): Buffer | null {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  return createHash("sha256").update(`법률창고-세션:${password}`).digest();
}

function sign(value: string): string | null {
  const key = secret();
  return key ? createHmac("sha256", key).update(value).digest("hex") : null;
}

/** "값.서명" 형태의 쿠키를 검증하고 값을 돌려준다. 서명이 틀리면 null. */
function verify(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot < 1) return null;
  const value = cookieValue.slice(0, dot);
  const given = Buffer.from(cookieValue.slice(dot + 1));
  const expected = Buffer.from(sign(value) ?? "");
  if (expected.length === 0 || given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? value : null;
}

const cookieOptions = (maxAgeSeconds: number) => ({
  httpOnly: true, // 화면의 코드가 쿠키를 읽지 못하게 한다.
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: maxAgeSeconds,
});

/** 지금 요청이 로그인된 상태인지 확인한다. */
export async function isLoggedIn(): Promise<boolean> {
  const store = await cookies();
  const value = verify(store.get(SESSION_COOKIE)?.value);
  if (!value) return false;
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "locked"; minutesLeft: number }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "not_configured" };

/** 비밀번호를 확인하고, 맞으면 로그인 쿠키를 심는다. */
export async function login(password: string): Promise<LoginResult> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return { ok: false, reason: "not_configured" };

  const store = await cookies();
  const now = Date.now();

  // 틀린 횟수와 잠금 해제 시각을 읽는다. 형식: "횟수:잠금해제시각"
  let fails = 0;
  let lockedUntil = 0;
  const failValue = verify(store.get(FAIL_COOKIE)?.value);
  if (failValue) {
    const [count, until] = failValue.split(":").map(Number);
    if (Number.isFinite(count)) fails = count;
    if (Number.isFinite(until)) lockedUntil = until;
  }
  if (lockedUntil > now) {
    return { ok: false, reason: "locked", minutesLeft: Math.ceil((lockedUntil - now) / 60_000) };
  }
  if (lockedUntil !== 0) fails = 0; // 잠금 시간이 지났으면 처음부터 다시 센다.

  // 길이가 달라도 걸리는 시간이 같도록 해시끼리 비교한다.
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const correct = timingSafeEqual(digest(password), digest(expected));

  if (correct) {
    const expiresAt = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
    store.set(SESSION_COOKIE, `${expiresAt}.${sign(expiresAt)}`, cookieOptions(SESSION_DAYS * 24 * 60 * 60));
    store.delete(FAIL_COOKIE);
    return { ok: true };
  }

  fails += 1;
  const locked = fails >= MAX_FAILS;
  const nextValue = `${locked ? 0 : fails}:${locked ? now + LOCK_MINUTES * 60_000 : 0}`;
  store.set(FAIL_COOKIE, `${nextValue}.${sign(nextValue)}`, cookieOptions(24 * 60 * 60));
  return locked
    ? { ok: false, reason: "locked", minutesLeft: LOCK_MINUTES }
    : { ok: false, reason: "wrong", attemptsLeft: MAX_FAILS - fails };
}
