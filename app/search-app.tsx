"use client";

// 법률창고 화면 (PLAN 11~17번)
// - 로그인 화면: 비밀번호 한 개로 들어간다.
// - 검색 화면: 위쪽 토글(법령 / 선결정례 등), 검색창, 쟁점 정리, 결과 목록.
//   검색은 고른 토글의 범위만 한다. 다른 토글로 옮기면 그때 그 범위를 검색한다.
// 검색 결과는 이 화면(브라우저) 안에만 두며, 새로 고치면 사라진다. 서버에는 저장하지 않는다.

import { useEffect, useRef, useState } from "react";
import { findPersonalInfo } from "@/lib/privacy";
import type {
  CaseItem,
  CaseSummary,
  DetailResponse,
  ErrorResponse,
  LawArticle,
  LawResult,
  SearchPlan,
  SearchResponse,
  SearchScope,
} from "@/lib/types";

const PAGE_SIZE = 5; // 한 번에 5개씩 보여 준다.
const MAX_LAWS = 10; // 법령은 최대 10개
const MAX_CASES = 20; // 선결정례 등은 최대 20건
const SEARCH_LIMIT_MS = 60_000; // 검색은 최대 60초까지 기다린다.
const MORE_LIMIT_MS = 45_000; // 더보기·본문보기는 최대 45초까지 기다린다.

/** 서버가 돌려준 오류 */
class ApiError extends Error {
  constructor(
    public code: ErrorResponse["error"] | "network",
    message: string,
  ) {
    super(message);
  }
}

/** 서버 창구에 요청을 보내고 답을 받는다. */
async function post<T>(path: string, body: unknown, limitMs: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(limitMs),
    });
  } catch {
    throw new ApiError("network", "자료를 불러오지 못했습니다.");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as Partial<ErrorResponse> | null;
    throw new ApiError(error?.error ?? "failed", error?.message ?? "자료를 불러오지 못했습니다.");
  }
  return data as T;
}

const caseKey = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;

const formatDate = (yyyymmdd: string) =>
  yyyymmdd.length === 8 ? `${yyyymmdd.slice(0, 4)}.${yyyymmdd.slice(4, 6)}.${yyyymmdd.slice(6, 8)}.` : "";

// ─────────────────────────────────────────────────────────────
// 전체 화면: 로그인 여부에 따라 로그인 화면 또는 검색 화면을 보여 준다.
// ─────────────────────────────────────────────────────────────

export default function SearchApp() {
  const [auth, setAuth] = useState<"checking" | "out" | "in">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((response) => response.json())
      .then((data: { loggedIn?: boolean }) => {
        if (!cancelled) setAuth(data.loggedIn ? "in" : "out");
      })
      .catch(() => {
        if (!cancelled) setAuth("out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="bg-[#1b3a6b] text-white">
        <div className="mx-auto flex w-full max-w-3xl items-baseline gap-3 px-4 py-4">
          <h1 className="text-xl font-bold tracking-tight">법률창고</h1>
          <p className="text-sm text-blue-100">법령 · 선결정례 · 판결 찾기</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {auth === "checking" && <p className="py-16 text-center text-sm text-slate-500">확인하는 중입니다…</p>}
        {auth === "out" && <LoginForm onSuccess={() => setAuth("in")} />}
        {auth === "in" && <SearchScreen onLoggedOut={() => setAuth("out")} />}
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 로그인 화면
// ─────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await post("/api/login", { password }, 15_000);
      onSuccess();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "로그인하지 못했습니다.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-10 w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-[#1b3a6b]">접속 비밀번호</h2>
      <label htmlFor="password" className="sr-only">
        비밀번호
      </label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        autoFocus
        className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-base outline-none focus:border-[#1b3a6b] focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        disabled={!password || busy}
        className="mt-3 w-full rounded bg-[#1b3a6b] px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "확인하는 중…" : "들어가기"}
      </button>
      {message && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {message}
        </p>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// 검색 화면
// ─────────────────────────────────────────────────────────────

type Tab = SearchScope; // "law"(법령) 또는 "case"(선결정례 등)
type DetailState = { status: "loading" } | { status: "error" } | { status: "done"; data: DetailResponse };
type LoadStatus = "idle" | "loading" | "done" | "error";

const EMPTY_LAW_RESULT: LawResult = { basisLabel: "", notice: null, laws: [] };

function SearchScreen({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("law");
  const [facts, setFacts] = useState("");
  const [warning, setWarning] = useState("");

  // 검색은 토글별로 따로 한다. 법령 토글에서 검색하면 법령만 찾고,
  // 선결정례 등 토글로 옮기면 그때 사례를 찾는다. (반대 순서도 같다)
  const [lawStatus, setLawStatus] = useState<LoadStatus>("idle");
  const [caseStatus, setCaseStatus] = useState<LoadStatus>("idle");
  const [lawResult, setLawResult] = useState<LawResult>(EMPTY_LAW_RESULT);
  const [cases, setCases] = useState<CaseItem[]>([]);
  // "인용 사례만"처럼 결과 조건으로 걸러 냈을 때의 안내 문구
  const [caseNotice, setCaseNotice] = useState<string | null>(null);

  // 첫 검색 때 AI가 만든 쟁점과 검색 계획. 다른 토글을 검색할 때 다시 보내 AI 분석을 한 번만 하게 한다.
  const [issue, setIssue] = useState("");
  const [outOfScope, setOutOfScope] = useState<string | null>(null);
  const [plan, setPlan] = useState<SearchPlan | null>(null);

  const [lawVisible, setLawVisible] = useState(PAGE_SIZE);
  const [caseVisible, setCaseVisible] = useState(PAGE_SIZE);
  const [summaries, setSummaries] = useState<Record<string, CaseSummary>>({});
  const [moreStatus, setMoreStatus] = useState<"idle" | "loading" | "error">("idle");

  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const lastFacts = useRef("");
  // 새 검색을 시작하면 번호가 올라간다. 이전 검색의 답이 늦게 도착해도 화면에 섞이지 않게 한다.
  const searchId = useRef(0);

  /** 로그인이 풀렸으면 로그인 화면으로 돌려보낸다. */
  function handleAuthError(error: unknown): boolean {
    if (error instanceof ApiError && error.code === "unauthorized") {
      onLoggedOut();
      return true;
    }
    return false;
  }

  /** 한쪽 범위(법령 또는 선결정례 등)만 검색한다. 사례는 이어서 처음 5건의 요약까지 받는다. */
  async function runScope(scope: Tab, text: string, knownPlan: SearchPlan | null) {
    const id = searchId.current;
    const setStatus = scope === "law" ? setLawStatus : setCaseStatus;
    setStatus("loading");

    const startedAt = Date.now();
    try {
      const found = await post<SearchResponse>("/api/search", { facts: text, scope, plan: knownPlan }, SEARCH_LIMIT_MS);
      if (id !== searchId.current) return; // 그 사이 새 검색이 시작됐으면 버린다.

      let firstSummaries: Record<string, CaseSummary> = {};
      const firstCases = scope === "case" ? (found.cases ?? []).slice(0, PAGE_SIZE) : [];
      if (firstCases.length > 0) {
        // 남은 시간 안에 요약까지 끝나야 한다. (검색 전체가 60초 이내)
        const remaining = Math.max(1_000, SEARCH_LIMIT_MS - (Date.now() - startedAt));
        const { summaries: list } = await post<{ summaries: CaseSummary[] }>(
          "/api/summarize",
          { items: firstCases.map(({ kind, id: caseId }) => ({ kind, id: caseId })) },
          remaining,
        );
        if (id !== searchId.current) return;
        firstSummaries = Object.fromEntries(list.map((s) => [caseKey(s), s]));
      }

      setPlan(found.plan);
      setIssue(found.issue);
      setOutOfScope(found.outOfScope);

      if (found.outOfScope) {
        // 조세 분야가 아니면 양쪽 모두 빈 결과로 끝낸다.
        setLawResult(EMPTY_LAW_RESULT);
        setCases([]);
        setLawStatus("done");
        setCaseStatus("done");
        return;
      }
      if (scope === "law") {
        setLawResult(found.lawResult ?? EMPTY_LAW_RESULT);
      } else {
        setCases((found.cases ?? []).slice(0, MAX_CASES));
        setCaseNotice(found.caseNotice ?? null);
        setSummaries(firstSummaries);
      }
      setStatus("done");
    } catch (error) {
      if (id !== searchId.current) return;
      if (handleAuthError(error)) return;
      if (error instanceof ApiError && error.code === "privacy") {
        setWarning(error.message);
        setStatus("idle");
        return;
      }
      setStatus("error");
    }
  }

  /** 검색 버튼: 지금 고른 토글의 범위만 새로 검색한다. */
  function search(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    // 주민등록번호·사업자등록번호 형태가 있으면 서버로 보내지 않고 멈춘다.
    const privacyWarning = findPersonalInfo(trimmed);
    if (privacyWarning) {
      setWarning(privacyWarning);
      return;
    }

    searchId.current += 1;
    lastFacts.current = trimmed;
    setWarning("");
    setLawStatus("idle");
    setCaseStatus("idle");
    setLawResult(EMPTY_LAW_RESULT);
    setCases([]);
    setCaseNotice(null);
    setIssue("");
    setOutOfScope(null);
    setPlan(null);
    setSummaries({});
    setLawVisible(PAGE_SIZE);
    setCaseVisible(PAGE_SIZE);
    setMoreStatus("idle");
    setOpenItems({});
    setDetails({});

    void runScope(tab, trimmed, null);
  }

  /** 토글 전환: 이미 검색한 사실관계가 있고 그 토글을 아직 찾지 않았으면, 그때 그 범위를 검색한다. */
  function selectTab(next: Tab) {
    setTab(next);
    const status = next === "law" ? lawStatus : caseStatus;
    if (lastFacts.current && status === "idle" && !outOfScope) void runScope(next, lastFacts.current, plan);
  }

  /** 더보기 (법령): 이미 받아 둔 목록에서 다음 5개를 보여 준다. */
  function showMoreLaws() {
    setLawVisible((count) => Math.min(count + PAGE_SIZE, MAX_LAWS));
  }

  /** 더보기 (사례): 다음 5건의 요약을 새로 받아서 보여 준다. */
  async function showMoreCases() {
    if (moreStatus === "loading") return;
    const next = cases.slice(caseVisible, caseVisible + PAGE_SIZE);
    if (next.length === 0) return;

    const id = searchId.current;
    setMoreStatus("loading");
    try {
      const { summaries: list } = await post<{ summaries: CaseSummary[] }>(
        "/api/summarize",
        { items: next.map(({ kind, id: caseId }) => ({ kind, id: caseId })) },
        MORE_LIMIT_MS,
      );
      if (id !== searchId.current) return;
      setSummaries((previous) => ({ ...previous, ...Object.fromEntries(list.map((s) => [caseKey(s), s])) }));
      setCaseVisible((count) => Math.min(count + PAGE_SIZE, MAX_CASES));
      setMoreStatus("idle");
    } catch (error) {
      if (id !== searchId.current) return;
      if (handleAuthError(error)) return;
      setMoreStatus("error");
    }
  }

  /** 본문보기 (사례): 처음 펼칠 때 그 한 건의 전문을 받아 온다. */
  async function toggleCase(item: CaseItem) {
    const key = caseKey(item);
    const willOpen = !openItems[key];
    setOpenItems((previous) => ({ ...previous, [key]: willOpen }));
    if (!willOpen || details[key]?.status === "done" || details[key]?.status === "loading") return;

    setDetails((previous) => ({ ...previous, [key]: { status: "loading" } }));
    try {
      const data = await post<DetailResponse>("/api/detail", { kind: item.kind, id: item.id }, MORE_LIMIT_MS);
      setDetails((previous) => ({ ...previous, [key]: { status: "done", data } }));
    } catch (error) {
      if (handleAuthError(error)) return;
      setDetails((previous) => ({ ...previous, [key]: { status: "error" } }));
    }
  }

  const laws = lawResult.laws.slice(0, MAX_LAWS);
  const shownLaws = laws.slice(0, lawVisible);
  const shownCases = cases.slice(0, caseVisible);
  const currentStatus = tab === "law" ? lawStatus : caseStatus;

  return (
    <div className="flex flex-col gap-4">
      {/* 위쪽 토글 */}
      <div role="tablist" aria-label="결과 종류" className="grid grid-cols-2 overflow-hidden rounded-lg border border-[#1b3a6b]">
        <TabButton selected={tab === "law"} onClick={() => selectTab("law")} label="법령" count={lawStatus === "done" ? laws.length : null} />
        <TabButton selected={tab === "case"} onClick={() => selectTab("case")} label="선결정례 등" count={caseStatus === "done" ? cases.length : null} />
      </div>

      {/* 검색창 */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search(facts);
        }}
        className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      >
        <label htmlFor="facts" className="sr-only">
          사실관계
        </label>
        <textarea
          id="facts"
          value={facts}
          onChange={(event) => {
            setFacts(event.target.value);
            if (warning) setWarning("");
            // 길게 적으면 검색창이 따라서 늘어난다.
            const box = event.target;
            box.style.height = "auto";
            box.style.height = `${box.scrollHeight}px`;
          }}
          rows={4}
          placeholder="사례의 사실관계를 자세히 적어 주세요. 거래·과세 시점(연도)을 함께 적으면 그 시점의 법령을 찾습니다."
          className="block max-h-[60vh] w-full resize-none rounded border border-slate-300 px-3 py-2 text-base leading-relaxed outline-none focus:border-[#1b3a6b] focus:ring-2 focus:ring-blue-100"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">의뢰인을 알아볼 수 있는 정보는 적지 마세요.</p>
          <button
            type="submit"
            disabled={!facts.trim() || currentStatus === "loading"}
            className="rounded bg-[#1b3a6b] px-5 py-2 font-semibold text-white disabled:opacity-50"
          >
            {currentStatus === "loading" ? "찾는 중…" : tab === "law" ? "법령 검색" : "선결정례 검색"}
          </button>
        </div>
        {warning && (
          <p role="alert" className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warning}
          </p>
        )}
      </form>

      {/* 쟁점 정리: 어느 쪽이든 한 번 검색하면 나온다. */}
      {(issue || outOfScope) && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {issue && (
            <p className="leading-relaxed">
              <span className="mr-2 rounded bg-[#1b3a6b] px-2 py-0.5 text-xs font-semibold text-white">쟁점</span>
              {issue}
            </p>
          )}
          {outOfScope && <p className="text-sm text-slate-700">{outOfScope}</p>}
          {tab === "law" && lawStatus === "done" && lawResult.basisLabel && (
            <p className="mt-2 text-sm font-semibold text-[#1b3a6b]">{lawResult.basisLabel}</p>
          )}
          {tab === "law" && lawStatus === "done" && lawResult.notice && <p className="mt-1 text-sm text-slate-600">{lawResult.notice}</p>}
          {tab === "case" && caseStatus === "done" && caseNotice && <p className="mt-1 text-sm text-slate-600">{caseNotice}</p>}
        </section>
      )}

      {/* 검색 중 */}
      {currentStatus === "loading" && (
        <p role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
          {tab === "law" ? "법령을 찾는 중입니다…" : "선결정례와 판결을 찾는 중입니다…"} 길면 1분까지 걸립니다.
        </p>
      )}

      {/* 조회 실패 또는 60초 초과 */}
      {currentStatus === "error" && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-800">자료를 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={() => void runScope(tab, lastFacts.current, plan)}
            className="mt-3 rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 법령 결과 */}
      {tab === "law" && lawStatus === "done" && !outOfScope && (
        <section aria-label="법령" className="flex flex-col gap-3">
          {laws.length === 0 && <EmptyMessage text="관련 법령을 찾지 못했습니다." />}
          {shownLaws.map((law) => {
            const key = `law:${law.lawName}:${law.articleLabel}`;
            return (
              <LawCard
                key={key}
                law={law}
                open={!!openItems[key]}
                onToggle={() => setOpenItems((previous) => ({ ...previous, [key]: !previous[key] }))}
              />
            );
          })}
          {lawVisible < laws.length && <MoreButton onClick={showMoreLaws} />}
        </section>
      )}

      {/* 선결정례 등 결과 */}
      {tab === "case" && caseStatus === "done" && !outOfScope && (
        <section aria-label="선결정례 등" className="flex flex-col gap-3">
          {cases.length === 0 && <EmptyMessage text="관련 사례를 찾지 못했습니다." />}
          {shownCases.map((item) => {
            const key = caseKey(item);
            return (
              <CaseCard
                key={key}
                item={item}
                summary={summaries[key]}
                open={!!openItems[key]}
                detail={details[key]}
                onToggle={() => void toggleCase(item)}
              />
            );
          })}
          {caseVisible < cases.length && (
            <>
              {moreStatus === "error" && (
                <p role="alert" className="text-center text-sm text-red-700">
                  자료를 불러오지 못했습니다. 아래 버튼으로 다시 시도해 주세요.
                </p>
              )}
              <MoreButton
                onClick={() => void showMoreCases()}
                busy={moreStatus === "loading"}
                label={moreStatus === "error" ? "다시 시도" : "더보기"}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 작은 부품들
// ─────────────────────────────────────────────────────────────

function TabButton({ selected, onClick, label, count }: { selected: boolean; onClick: () => void; label: string; count: number | null }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`px-3 py-2.5 text-center font-semibold ${selected ? "bg-[#1b3a6b] text-white" : "bg-white text-[#1b3a6b]"}`}
    >
      {label}
      {count !== null && <span className="ml-1 text-sm font-normal opacity-80">({count})</span>}
    </button>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">{text}</p>;
}

function MoreButton({ onClick, busy = false, label = "더보기" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-lg border border-[#1b3a6b] bg-white px-4 py-2.5 font-semibold text-[#1b3a6b] disabled:opacity-60"
    >
      {busy ? "찾는 중…" : label}
    </button>
  );
}

function BodyToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="mt-3 text-sm font-semibold text-[#1b3a6b] underline-offset-2 hover:underline">
      {open ? "본문 접기 ▲" : "본문보기 ▼"}
    </button>
  );
}

function BodyText({ text }: { text: string }) {
  return (
    <div className="mt-2 max-h-[70vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed">
      {text}
    </div>
  );
}

function LawCard({ law, open, onToggle }: { law: LawArticle; open: boolean; onToggle: () => void }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="break-words font-semibold text-[#1b3a6b]">
        {law.lawName} {law.articleLabel}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">
        {law.historical ? "입력 시점 기준" : "현행"}
        {formatDate(law.effectiveDate) && ` · 시행 ${formatDate(law.effectiveDate)}`}
      </p>
      {law.reason && <p className="mt-2 break-words leading-relaxed">{law.reason}</p>}
      <BodyToggle open={open} onToggle={onToggle} />
      {open && <BodyText text={law.text} />}
    </article>
  );
}

/** 결과에 따라 표시 색을 정한다. */
function resultStyle(result: string): string {
  if (/미확인/.test(result)) return "border-slate-300 bg-slate-100 text-slate-600";
  if (/(인용|취소|경정|재조사|국패|패소)/.test(result)) return "border-blue-300 bg-blue-50 text-blue-800";
  return "border-rose-300 bg-rose-50 text-rose-800"; // 기각, 각하, 국승 등
}

function CaseCard({
  item,
  summary,
  open,
  detail,
  onToggle,
}: {
  item: CaseItem;
  summary: CaseSummary | undefined;
  open: boolean;
  detail: DetailState | undefined;
  onToggle: () => void;
}) {
  const result = summary?.result && summary.result !== "결과 미확인" ? summary.result : item.resultFromList || summary?.result || "결과 미확인";
  const kindLabel = item.kind === "decision" ? "조세심판원 결정" : "법원 판결";

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* 맨 위: 사건번호와 결과 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="break-all font-semibold text-[#1b3a6b]">{item.caseNumber}</h3>
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${resultStyle(result)}`}>{result}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {kindLabel}
        {formatDate(item.date) && ` · ${formatDate(item.date)}`}
      </p>

      {/* 요약 */}
      {summary?.summary ? (
        <p className="mt-2 break-words leading-relaxed">{summary.summary}</p>
      ) : (
        <div className="mt-2 break-words leading-relaxed">
          <p>{item.title}</p>
          <p className="mt-1 text-sm text-slate-500">
            {summary && !summary.hasBody
              ? "법제처 API가 이 자료의 본문을 제공하지 않아 요약하지 못했습니다. 위는 사건명입니다."
              : "요약을 만들지 못했습니다. 위는 사건명입니다."}
          </p>
        </div>
      )}

      {/* 본문보기 */}
      <BodyToggle open={open} onToggle={onToggle} />
      {open && detail?.status === "loading" && <p className="mt-2 text-sm text-slate-500">본문을 불러오는 중입니다…</p>}
      {open && detail?.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          자료를 불러오지 못했습니다. 본문보기를 다시 눌러 주세요.
        </p>
      )}
      {open && detail?.status === "done" && detail.data.text && <BodyText text={detail.data.text} />}
      {open && detail?.status === "done" && !detail.data.text && (
        <p className="mt-2 text-sm text-slate-600">
          법제처 API가 이 자료의 본문을 제공하지 않습니다.
          {detail.data.originalUrl && (
            <>
              {" "}
              <a href={detail.data.originalUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#1b3a6b] underline">
                원문 페이지에서 보기
              </a>
            </>
          )}
        </p>
      )}
    </article>
  );
}
