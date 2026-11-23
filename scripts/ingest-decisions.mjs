// 조세심판원 결정례의 사건명·재결요지·주문을 법제처에서 받아 Supabase 표(tax_decisions)에 넣는다.
// AI를 쓰지 않으므로 OpenAI 요금이 들지 않는다. 본문(이유)은 저장하지 않는다.
//
// 사용 (프로젝트 폴더에서):
//   node --env-file=.env --env-file=.env.local scripts/ingest-decisions.mjs all      ← 전체 받기 (끊기면 이어서 받는다)
//   node --env-file=.env --env-file=.env.local scripts/ingest-decisions.mjs recent   ← 최근에 새로 나온 것만 받기
//
// 인증값과 키는 화면에 출력하지 않는다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { outcomeFromDecisionOrder } from "../lib/result-filter.ts";

const OC = process.env.LAW_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!OC || !SUPABASE_URL || !SUPABASE_KEY) {
  console.log("LAW_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY가 모두 있어야 합니다.");
  process.exit(1);
}

const mode = process.argv[2] === "recent" ? "recent" : "all";
// 어디까지 받았는지 적어 두는 파일. 프로젝트 밖(임시 폴더)에 둔다.
const progressFile = process.argv[3] ?? path.join(os.tmpdir(), "law-warehouse-ingest-progress.json");
const AT_ONCE = 10; // 본문을 동시에 조회하는 건수
const PAGE_SIZE = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 법제처 API 호출. 실패하면 몇 번 다시 시도한다. 오류 문구에는 주소(인증값 포함)를 넣지 않는다. */
async function lawApi(file, params) {
  const url = new URL(`https://www.law.go.kr/DRF/${file}`);
  url.search = new URLSearchParams({ OC, type: "JSON", ...params }).toString();
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`상태 코드 ${response.status}`);
      return JSON.parse(await response.text());
    } catch {
      if (attempt >= 4) throw new Error(`법제처 조회 실패 (${file})`);
      await sleep(1500 * attempt);
    }
  }
}

/** HTML 태그와 여러 칸 띄어쓰기를 정리한다. */
const clean = (value) =>
  String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 목록 한 쪽을 받아 온다. */
async function listPage(page, sort) {
  const box = Object.values(await lawApi("lawSearch.do", { target: "ttSpecialDecc", display: String(PAGE_SIZE), page: String(page), sort }))[0];
  const list = [].concat(box?.decc ?? []);
  return { total: Number(box?.totalCnt ?? 0), list };
}

/** 목록의 한 건을 본문까지 조회해 표에 넣을 한 줄로 만든다. */
async function toRow(item) {
  const id = String(item["특별행정심판재결례일련번호"] ?? "");
  if (!/^\d+$/.test(id)) return null;
  const detail = Object.values(await lawApi("lawService.do", { target: "ttSpecialDecc", ID: id }))[0];
  if (!detail || typeof detail !== "object") return null;
  const order = clean(detail["주문"]);
  return {
    id: Number(id),
    case_no: clean(item["청구번호"]) || clean(detail["청구번호"]),
    decided: clean(item["의결일자"] || detail["의결일자"]).replace(/\D/g, "").slice(0, 8),
    tax: clean(detail["세목"]).slice(0, 40),
    title: clean(detail["사건명"] || item["사건명"]).slice(0, 600),
    gist: clean(detail["재결요지"]).slice(0, 2500),
    order_text: order.slice(0, 300),
    outcome: outcomeFromDecisionOrder(order),
  };
}

/** 목록 여러 건을 몇 건씩 동시에 조회한다. 실패한 건은 건너뛰고 번호를 돌려준다. */
async function toRows(list) {
  const rows = [];
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const item = list[next];
      next += 1;
      try {
        const row = await toRow(item);
        if (row && row.case_no) rows.push(row);
      } catch {
        failed.push(String(item["청구번호"] ?? ""));
      }
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return { rows, failed };
}

/** Supabase 호출. 실패하면 몇 번 다시 시도한다. */
async function supabase(pathAndQuery, options = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
        ...options,
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`상태 코드 ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return response;
    } catch (error) {
      if (attempt >= 7) throw new Error(`Supabase 저장소 호출 실패: ${error instanceof Error ? error.message : ""}`);
      await sleep(5000 * attempt); // 저장소가 바쁠 때는 넉넉히 쉬었다가 다시 시도한다.
    }
  }
}

/** 여러 줄을 표에 넣는다. 이미 있는 번호는 새 내용으로 바꾼다. */
async function save(rows) {
  if (rows.length === 0) return;
  // 한 쪽 안에 같은 번호가 두 번 있으면 저장이 거절되므로 하나만 남긴다.
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  // 표가 커지면 검색용 색인을 고치는 데 시간이 걸려 한 번에 많이 넣으면 시간 제한에 걸린다. 25건씩 나눠 넣는다.
  for (let start = 0; start < unique.length; start += 25) {
    await supabase("tax_decisions?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(unique.slice(start, start + 25)),
    });
  }
}

/** 이 번호들 중 표에 이미 있는 것이 몇 건인지 센다. */
async function countExisting(ids) {
  if (ids.length === 0) return 0;
  const response = await supabase(`tax_decisions?select=id&id=in.(${ids.join(",")})`);
  return (await response.json()).length;
}

const startedAt = Date.now();
const elapsed = () => `${Math.round((Date.now() - startedAt) / 60000)}분`;

if (mode === "all") {
  // 오래된 것부터 차례로 받는다. 새 결정은 맨 뒤에 붙으므로, 받는 도중에 순서가 밀리지 않는다.
  let progress = { page: 0, saved: 0, failed: [] };
  if (fs.existsSync(progressFile)) progress = { ...progress, ...JSON.parse(fs.readFileSync(progressFile, "utf8")) };
  const { total } = await listPage(1, "dasc");
  const pages = Math.ceil(total / PAGE_SIZE);
  console.log(`전체 ${total}건, ${pages}쪽. ${progress.page}쪽까지 받은 상태에서 시작합니다.`);

  for (let page = progress.page + 1; page <= pages; page += 1) {
    const { list } = await listPage(page, "dasc");
    const { rows, failed } = await toRows(list);
    await save(rows);
    progress = { page, saved: progress.saved + rows.length, failed: [...progress.failed, ...failed].slice(-500) };
    fs.writeFileSync(progressFile, JSON.stringify(progress));
    if (page % 25 === 0 || page === pages) {
      console.log(`${page}/${pages}쪽 (${Math.round((page / pages) * 100)}%), 저장 ${progress.saved}건, 건너뜀 ${progress.failed.length}건, 경과 ${elapsed()}`);
    }
  }
  console.log(`전체 받기 완료. 저장 ${progress.saved}건, 건너뜀 ${progress.failed.length}건, 경과 ${elapsed()}`);
} else {
  // 최근 것부터 받다가, 한 쪽 전체가 이미 표에 있으면 멈춘다.
  let saved = 0;
  for (let page = 1; page <= 30; page += 1) {
    const { list } = await listPage(page, "ddes");
    if (list.length === 0) break;
    const ids = list.map((item) => String(item["특별행정심판재결례일련번호"] ?? "")).filter((id) => /^\d+$/.test(id));
    const existing = await countExisting(ids);
    const { rows } = await toRows(list);
    await save(rows);
    saved += rows.length - existing;
    console.log(`최근 ${page}쪽: ${list.length}건 중 이미 있던 것 ${existing}건`);
    if (existing >= ids.length) break;
  }
  console.log(`최근 결정 받기 완료. 새로 넣은 것 약 ${Math.max(0, saved)}건`);
}
