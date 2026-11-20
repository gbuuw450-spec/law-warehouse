// 로그인 상태 확인 창구: 화면이 처음 열릴 때 "이미 로그인했는지" 물어본다.

import { isLoggedIn } from "@/lib/session";

export async function GET() {
  return Response.json({ loggedIn: await isLoggedIn() });
}
