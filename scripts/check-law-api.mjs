// 법제처 API 연결 확인 스크립트 (PLAN.md 1번 작업)
//
// 하는 일: .env의 LAW_API_KEY로 법령, 법원 판결, 조세심판원 결정례를
//          각각 1건씩 "목록 조회 → 본문 조회" 해 보고, 응답에 어떤 항목이 들어 있는지 보여 준다.
// 실행법:  npm run check:law
//
// 주의: 인증값(LAW_API_KEY)은 화면에 절대 출력하지 않는다.

const 인증값 = process.env.LAW_API_KEY;
const 기본주소 = "https://www.law.go.kr/DRF";
const 제한시간 = 20_000; // 한 번 조회에 최대 20초

// 확인할 자료 세 종류. target은 법제처 API가 자료 종류를 구분하는 이름이다.
const 확인목록 = [
  { 이름: "법령", target: "law", 검색어: "국세기본법" },
  { 이름: "법원 판결", target: "prec", 검색어: "공매" },
  { 이름: "조세심판원 결정례", target: "ttSpecialDecc", 검색어: "공매" },
];

// 긴 값은 앞부분만 잘라서 보여 준다.
function 줄이기(값, 길이 = 60) {
  const 글자 = typeof 값 === "string" ? 값 : JSON.stringify(값);
  if (글자 === undefined) return "(없음)";
  // 응답 안의 링크에 인증값(OC=...)이 섞여 있으므로 가려서 출력한다.
  const 한줄 = 글자.replace(/OC=[^&\s"']+/g, "OC=***").replace(/\s+/g, " ").trim();
  return 한줄.length > 길이 ? `${한줄.slice(0, 길이)}… (총 ${한줄.length}자)` : 한줄;
}

// 응답 안에서 "자료 목록(배열)"을 찾아낸다. 자료가 1건이면 배열이 아닌 객체로 올 수도 있다.
function 목록찾기(응답) {
  const 바깥 = Object.values(응답)[0];
  if (!바깥 || typeof 바깥 !== "object") return { 바깥: null, 목록: [] };
  for (const 값 of Object.values(바깥)) {
    if (Array.isArray(값)) return { 바깥, 목록: 값 };
  }
  for (const 값 of Object.values(바깥)) {
    if (값 && typeof 값 === "object") return { 바깥, 목록: [값] };
  }
  return { 바깥, 목록: [] };
}

// 객체의 항목 이름과 값의 앞부분을 한 줄씩 출력한다.
function 항목출력(객체, 들여쓰기 = "    ") {
  for (const [이름, 값] of Object.entries(객체)) {
    const 종류 = Array.isArray(값) ? "목록" : typeof 값 === "object" && 값 !== null ? "묶음" : "값";
    console.log(`${들여쓰기}- ${이름} [${종류}]: ${줄이기(값)}`);
  }
}

// 법제처 API를 한 번 호출한다. 주소에 인증값이 들어 있으므로 주소는 출력하지 않는다.
async function 호출(경로, 조건, 형식 = "JSON") {
  const 주소 = new URL(`${기본주소}/${경로}`);
  주소.search = new URLSearchParams({ OC: 인증값, type: 형식, ...조건 }).toString();

  const 응답 = await fetch(주소, { signal: AbortSignal.timeout(제한시간) });
  const 본문 = await 응답.text();

  if (!응답.ok) throw new Error(`서버가 오류를 돌려줬습니다 (상태 코드 ${응답.status})`);
  if (형식 !== "JSON") return 본문; // HTML은 글자 그대로 돌려준다.
  try {
    return JSON.parse(본문);
  } catch {
    // JSON이 아니면 대개 인증 실패 안내 페이지다.
    throw new Error(`JSON이 아닌 응답입니다: ${줄이기(본문.replace(/<[^>]+>/g, " "), 150)}`);
  }
}

async function 한종류확인({ 이름, target, 검색어 }) {
  console.log(`\n━━━ ${이름} (target=${target}, 검색어="${검색어}") ━━━`);

  // 법원 판결은 출처(대법원 / 국세법령정보시스템)에 따라 본문 조회 방식이 달라 따로 확인한다.
  if (target === "prec") return 판결확인(검색어);

  // 1) 목록 조회
  const 목록응답 = await 호출("lawSearch.do", { target, query: 검색어, display: "1" });
  const { 바깥, 목록 } = 목록찾기(목록응답);
  if (!바깥) throw new Error(`예상과 다른 응답입니다: ${줄이기(목록응답, 150)}`);

  console.log(`  [목록 조회] 전체 건수: ${바깥.totalCnt ?? "(항목 없음)"}`);
  if (목록.length === 0) throw new Error(`자료가 0건입니다: ${줄이기(목록응답, 150)}`);

  const 첫자료 = 목록[0];
  console.log("  [목록 조회] 첫 번째 자료의 항목:");
  항목출력(첫자료);

  // 2) 본문 조회: 목록에서 받은 일련번호(ID)로 한 건의 전문을 가져온다.
  const 일련번호이름 = Object.keys(첫자료).find((k) => /일련번호$/.test(k) || k === "법령ID");
  if (!일련번호이름) throw new Error("목록에서 일련번호 항목을 찾지 못해 본문을 조회할 수 없습니다.");

  // 법령은 MST(법령일련번호)로, 나머지는 ID로 조회한다.
  const 본문조건 = target === "law" ? { MST: 첫자료[일련번호이름] } : { ID: 첫자료[일련번호이름] };
  const 본문응답 = await 호출("lawService.do", { target, ...본문조건 });
  const 본문바깥 = Object.values(본문응답)[0];
  if (!본문바깥 || typeof 본문바깥 !== "object") {
    throw new Error(`본문 응답이 예상과 다릅니다: ${줄이기(본문응답, 150)}`);
  }

  console.log(`  [본문 조회] (${일련번호이름} 사용) 본문의 항목:`);
  항목출력(본문바깥);
}

// 법원 판결 확인: 목록 20건을 받아 출처별로 1건씩 본문을 조회해 본다.
async function 판결확인(검색어) {
  const 목록응답 = await 호출("lawSearch.do", { target: "prec", query: 검색어, display: "20" });
  const { 바깥, 목록 } = 목록찾기(목록응답);
  if (!바깥 || 목록.length === 0) throw new Error(`자료가 없습니다: ${줄이기(목록응답, 150)}`);

  console.log(`  [목록 조회] 전체 건수: ${바깥.totalCnt ?? "(항목 없음)"}`);
  console.log("  [목록 조회] 첫 번째 자료의 항목:");
  항목출력(목록[0]);

  const 출처별 = {};
  for (const 자료 of 목록) 출처별[자료.데이터출처명] ??= 자료;
  console.log(`  [목록 조회] 20건의 출처 종류: ${Object.keys(출처별).join(", ")}`);

  let 성공수 = 0;
  for (const [출처, 자료] of Object.entries(출처별)) {
    console.log(`  [본문 조회] 출처="${출처}", 사건번호=${자료.사건번호}`);

    // 먼저 JSON으로 시도한다.
    const 본문응답 = await 호출("lawService.do", { target: "prec", ID: 자료.판례일련번호 });
    const 본문바깥 = Object.values(본문응답)[0];
    if (본문바깥 && typeof 본문바깥 === "object") {
      console.log("    JSON으로 조회됨. 본문의 항목:");
      항목출력(본문바깥, "      ");
      성공수 += 1;
      continue;
    }
    console.log(`    JSON으로는 조회되지 않음: ${줄이기(본문응답, 100)}`);

    // JSON이 안 되면 HTML로 다시 시도한다.
    const 웹문서 = await 호출("lawService.do", { target: "prec", ID: 자료.판례일련번호 }, "HTML");
    const 글자만 = 웹문서.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
    console.log(`    HTML로 조회됨 (전체 ${웹문서.length}자). 글자만 뽑은 앞부분: ${줄이기(글자만, 200)}`);
    const 안쪽주소 = [...웹문서.matchAll(/(?:src|href|url)\s*[=(]\s*["']?([^"'\s>)]+)/gi)].map((m) => m[1]);
    console.log(`    HTML 안의 주소: ${줄이기(안쪽주소.slice(0, 5).join(" | "), 300)}`);
    성공수 += 1;
  }
  if (성공수 === 0) throw new Error("어느 출처의 본문도 조회하지 못했습니다.");
}

async function 시작() {
  if (!인증값) {
    console.error("LAW_API_KEY를 찾지 못했습니다. .env 파일에 LAW_API_KEY=값 형태로 들어 있는지 확인하세요.");
    process.exit(1);
  }

  const 결과 = [];
  for (const 대상 of 확인목록) {
    try {
      await 한종류확인(대상);
      결과.push({ 이름: 대상.이름, 성공: true });
    } catch (오류) {
      const 이유 = 오류.name === "TimeoutError" ? "20초 안에 응답이 없습니다" : 오류.message;
      console.log(`  ✗ 실패: ${이유}`);
      결과.push({ 이름: 대상.이름, 성공: false });
    }
  }

  console.log("\n━━━ 요약 ━━━");
  for (const { 이름, 성공 } of 결과) console.log(`  ${성공 ? "✓ 성공" : "✗ 실패"}  ${이름}`);

  process.exit(결과.every((r) => r.성공) ? 0 : 1);
}

시작();
