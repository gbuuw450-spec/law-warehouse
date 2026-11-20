// 로그인 창구: 비밀번호를 받아 맞으면 로그인 쿠키를 심는다. (PLAN 16번)

import { fail, readJson } from "@/lib/http";
import { login } from "@/lib/session";

export async function POST(request: Request) {
  const body = await readJson(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return fail("bad_request", "비밀번호를 입력해 주세요.", 400);

  const result = await login(password);
  if (result.ok) return Response.json({ ok: true });

  if (result.reason === "locked") {
    return fail("locked", `여러 번 틀려서 잠겼습니다. 약 ${result.minutesLeft}분 뒤에 다시 시도해 주세요.`, 429);
  }
  if (result.reason === "wrong") {
    return fail("wrong_password", `비밀번호가 다릅니다. (남은 횟수 ${result.attemptsLeft}회)`, 401);
  }
  return fail("failed", "서버에 접속 비밀번호가 설정되지 않았습니다.", 500);
}
