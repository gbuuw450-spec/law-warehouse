// 테스트 사례 점검 스크립트 (PLAN.md 18번 작업)
//
// 하는 일: 실행 중인 앱(http://localhost:3000)에 로그인한 뒤, PRD의 테스트 사례 6건을 차례로 검색해
//          걸린 시간, 쟁점, 법령, 사례(사건번호·결과·요약)를 보여 준다.
// 실행법:  1) 다른 터미널에서 npm run dev   2) npm run test:cases
//          특정 사례만 보려면: npm run test:cases -- 1 5
//
// 주의: 접속 비밀번호는 .env에서 읽어 쓰고, 화면에 출력하지 않는다.

const 주소 = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const 테스트사례 = [
  "납세자가 2026.1월 공매대행통지를 받았는데 이게 처분성이 있는지, 없으면 각하사유인지",
  "양도소득세 리모델링 필요경비 인정 사례",
  "1세대1주택 비과세 관련 중 주민등록기준지와 달리 판단한 사례",
  "특정 거래처와의 지속되는 손실을 접대비로 보아 과세한 것에 대해 접대비로 보지 않은 사례",
  "부가가치세 가공 거래 관련하여 가장 최근 인용 또는 기각된 사례",
  "국외특수관계법인에 콜옵션을 저가로 양도한 것과 유사한 사례",
];

let 쿠키 = "";

async function 요청(경로, 내용) {
  const 응답 = await fetch(`${주소}${경로}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(쿠키 ? { Cookie: 쿠키 } : {}) },
    body: JSON.stringify(내용),
    signal: AbortSignal.timeout(70_000),
  });
  const 받은쿠키 = 응답.headers.getSetCookie?.() ?? [];
  if (받은쿠키.length > 0) 쿠키 = 받은쿠키.map((c) => c.split(";")[0]).join("; ");
  const 자료 = await 응답.json().catch(() => null);
  if (!응답.ok) throw new Error(`${경로} 실패 (${응답.status}): ${자료?.message ?? "응답 없음"}`);
  return 자료;
}

const 초 = (ms) => `${(ms / 1000).toFixed(1)}초`;
const 날짜 = (d) => (d?.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}.` : "날짜없음");

async function 한사례(번호, 사실관계) {
  console.log(`\n━━━ 테스트 사례 ${번호} ━━━\n입력: ${사실관계}`);
  // 화면과 같은 순서로 요청한다: 먼저 법령만 검색하고, 그 검색 계획을 그대로 써서 선결정례(조세심판원)를 검색한다.
  const 시작 = Date.now();
  const 법령검색 = await 요청("/api/search", { facts: 사실관계, scope: "law" });
  const 법령시간 = Date.now() - 시작;

  const 사례시작 = Date.now();
  const 사례검색 = await 요청("/api/search", { facts: 사실관계, scope: "decision", plan: 법령검색.plan });
  const 처음다섯 = (사례검색.cases ?? []).slice(0, 5);
  let 요약들 = [];
  if (처음다섯.length > 0) {
    요약들 = (await 요청("/api/summarize", { items: 처음다섯.map(({ kind, id }) => ({ kind, id })) })).summaries;
  }
  const 사례시간 = Date.now() - 사례시작;
  const 전체시간 = 법령시간 + 사례시간;
  const 판정 = (ms) => (ms <= 30_000 ? "30초 이내" : ms <= 60_000 ? "30초 초과, 60초 이내" : "60초 초과");

  const 검색 = {
    issue: 법령검색.issue,
    basisLabel: 법령검색.lawResult?.basisLabel ?? "",
    notice: 법령검색.outOfScope ?? 법령검색.lawResult?.notice ?? null,
    laws: 법령검색.lawResult?.laws ?? [],
    cases: 사례검색.cases ?? [],
  };

  console.log(`걸린 시간: 법령 토글 ${초(법령시간)} (${판정(법령시간)}) / 선결정례 등 토글 ${초(사례시간)} (${판정(사례시간)})`);
  console.log(`쟁점: ${검색.issue}`);
  console.log(`기준: ${검색.basisLabel}${검색.notice ? ` / 안내: ${검색.notice}` : ""}`);

  console.log(`법령 ${검색.laws.length}개:`);
  for (const 법령 of 검색.laws) {
    console.log(`  - ${법령.lawName} ${법령.articleLabel} [${법령.historical ? "입력 시점" : "현행"}, 시행 ${날짜(법령.effectiveDate)}, 본문 ${법령.text.length}자]`);
    console.log(`      이유: ${법령.reason}`);
  }

  console.log(`사례 ${검색.cases.length}건 (처음 5건은 요약 포함):`);
  검색.cases.forEach((사례, 순서) => {
    const 요약 = 요약들.find((s) => s.kind === 사례.kind && s.id === 사례.id);
    const 결과 = 요약?.result && 요약.result !== "결과 미확인" ? 요약.result : 사례.resultFromList || 요약?.result || "";
    console.log(`  ${순서 + 1}. ${사례.caseNumber} [${결과 || "-"}] ${날짜(사례.date)} (${사례.kind === "decision" ? "결정례" : "판결"}, ${사례.source})`);
    console.log(`      사건명: ${사례.title}`);
    if (요약) console.log(`      요약: ${요약.summary ?? (요약.hasBody ? "(요약 실패)" : "(본문 미제공)")}`);
  });

  return { 번호, 전체시간, 법령수: 검색.laws.length, 사례수: 검색.cases.length };
}

async function 시작() {
  if (!process.env.APP_PASSWORD) {
    console.error("APP_PASSWORD를 찾지 못했습니다. .env 파일을 확인하세요.");
    process.exit(1);
  }
  try {
    await 요청("/api/login", { password: process.env.APP_PASSWORD });
  } catch (오류) {
    console.error(`로그인하지 못했습니다. 앱이 ${주소} 에서 실행 중인지 확인하세요. (${오류.message})`);
    process.exit(1);
  }
  console.log("로그인 성공");

  const 고른번호 = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 테스트사례.length);
  const 대상 = 고른번호.length > 0 ? 고른번호 : 테스트사례.map((_, i) => i + 1);

  const 결과 = [];
  for (const 번호 of 대상) {
    try {
      결과.push(await 한사례(번호, 테스트사례[번호 - 1]));
    } catch (오류) {
      console.log(`  ✗ 실패: ${오류.name === "TimeoutError" ? "70초 안에 응답이 없습니다" : 오류.message}`);
      결과.push({ 번호, 실패: true });
    }
  }

  console.log("\n━━━ 요약 ━━━");
  for (const r of 결과) {
    console.log(r.실패 ? `  사례 ${r.번호}: 실패` : `  사례 ${r.번호}: ${초(r.전체시간)}, 법령 ${r.법령수}개, 사례 ${r.사례수}건`);
  }
  console.log("\n관련성(검색 적합도)과 요약 품질은 위 내용을 읽고 직접 판단해야 합니다.");
}

시작();
