// OpenAI 연결 확인 스크립트 (PLAN.md 2번 작업)
//
// 하는 일: .env의 OPENAI_API_KEY와 OPENAI_MODEL로 짧은 질문 1건을 보내 답이 오는지 확인한다.
// 실행법:  npm run check:openai
//
// 주의: API 키는 화면에 절대 출력하지 않는다. 오류 문구에 키가 섞여 나올 경우에도 가린다.

import OpenAI from "openai";

const 키 = process.env.OPENAI_API_KEY;
const 모델 = process.env.OPENAI_MODEL;

// 혹시 오류 문구에 키가 섞여 있으면 가린다.
function 가리기(글자) {
  let 결과 = String(글자);
  if (키) 결과 = 결과.split(키).join("***");
  return 결과.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

async function 시작() {
  if (!키) {
    console.error("OPENAI_API_KEY를 찾지 못했습니다. .env 파일을 확인하세요.");
    process.exit(1);
  }
  if (!모델) {
    console.error("OPENAI_MODEL을 찾지 못했습니다. .env 파일을 확인하세요.");
    process.exit(1);
  }

  console.log(`사용 모델: ${모델}`);
  const 연결 = new OpenAI({ apiKey: 키, timeout: 60_000, maxRetries: 0 });

  const 시작시각 = Date.now();
  try {
    const 응답 = await 연결.chat.completions.create({
      model: 모델,
      messages: [{ role: "user", content: "연결 확인입니다. '연결 성공'이라고만 답해 주세요." }],
    });
    const 걸린시간 = ((Date.now() - 시작시각) / 1000).toFixed(1);

    console.log(`답변: ${응답.choices[0]?.message?.content ?? "(내용 없음)"}`);
    console.log(`실제 응답한 모델: ${응답.model}`);
    console.log(`걸린 시간: ${걸린시간}초`);
    console.log(`사용량: 입력 ${응답.usage?.prompt_tokens ?? "?"} 토큰, 출력 ${응답.usage?.completion_tokens ?? "?"} 토큰`);
    console.log("\n✓ 성공  OpenAI 연결");
  } catch (오류) {
    console.log(`\n✗ 실패  OpenAI 연결`);
    console.log(`  상태 코드: ${오류.status ?? "(없음)"}`);
    console.log(`  이유: ${가리기(오류.message)}`);
    if (오류.status === 401) console.log("  → API 키가 틀렸거나 만료됐습니다. .env의 OPENAI_API_KEY를 확인하세요.");
    if (오류.status === 404) console.log("  → 모델 이름이 틀렸거나 이 키로 쓸 수 없는 모델입니다. .env의 OPENAI_MODEL을 확인하세요.");
    if (오류.status === 429) console.log("  → 사용 한도를 넘었거나 결제 정보가 등록되지 않았습니다.");
    process.exit(1);
  }
}

시작();
