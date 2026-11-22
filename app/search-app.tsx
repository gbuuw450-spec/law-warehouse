"use client";

// 법률창고 화면 (PLAN 11~17번)
// - 로그인 화면: 비밀번호 한 개로 들어간다.
// - 검색 화면: 위쪽 토글(법령 / 선결정례 / 법원 판결), 검색창, 결과 목록.
//   선결정례 토글에서는 결과(인용, 기각, 선택안함)를 골라 찾을 수 있다.
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
  WantedResult,
} from "@/lib/types";

const FIRST_PAGE = 6; // 처음에는 6개를 보여 준다.
const MORE_SIZE = 5; // 더보기를 누르면 5개씩 늘어난다.
const MAX_LAWS = 10; // 법령은 최대 10개
const MAX_CASES = 20; // 선결정례와 법원 판결은 각각 최대 20건
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

/** 지금 시각(밀리초). 검색에 걸린 시간을 잴 때 쓴다. */
const now = () => Date.now();

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

type Tab = SearchScope; // "law"(법령), "decision"(선결정례), "precedent"(법원 판결)
type CaseTab = Exclude<Tab, "law">;
type DetailState = { status: "loading" } | { status: "error" } | { status: "done"; data: DetailResponse };
type LoadStatus = "idle" | "loading" | "done" | "error";

/** 사례 토글(선결정례, 법원 판결) 하나의 상태 */
interface CaseState {
  status: LoadStatus;
  items: CaseItem[];
  /** 인용·기각으로 걸러 냈을 때의 안내 문구 */
  notice: string | null;
  /** 지금 화면에 보여 주는 건수 */
  visible: number;
  more: "idle" | "loading" | "error";
}

const EMPTY_LAW_RESULT: LawResult = { basisLabel: "", notice: null, laws: [] };
const EMPTY_CASE_STATE: CaseState = { status: "idle", items: [], notice: null, visible: FIRST_PAGE, more: "idle" };

const TAB_LABEL: Record<Tab, string> = { law: "법령", decision: "선결정례", precedent: "법원 판결" };
const LOADING_TEXT: Record<Tab, string> = {
  law: "법령을 찾는 중입니다…",
  decision: "조세심판원 선결정례를 찾는 중입니다…",
  precedent: "법원 판결을 찾는 중입니다…",
};
const WANTED_OPTIONS: { value: WantedResult; label: string }[] = [
  { value: null, label: "선택안함" },
  { value: "accepted", label: "인용" },
  { value: "rejected", label: "기각" },
];

function SearchScreen({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("law");
  const [facts, setFacts] = useState("");
  const [warning, setWarning] = useState("");

  // 검색은 토글별로 따로 한다. 법령 토글에서 검색하면 법령만 찾고,
  // 선결정례나 법원 판결 토글로 옮기면 그때 그 범위를 찾는다. (순서는 상관없다)
  const [lawStatus, setLawStatus] = useState<LoadStatus>("idle");
  const [lawResult, setLawResult] = useState<LawResult>(EMPTY_LAW_RESULT);
  const [lawVisible, setLawVisible] = useState(FIRST_PAGE);
  const [caseStates, setCaseStates] = useState<Record<CaseTab, CaseState>>({ decision: EMPTY_CASE_STATE, precedent: EMPTY_CASE_STATE });
  const patchCase = (kind: CaseTab, patch: Partial<CaseState>) =>
    setCaseStates((previous) => ({ ...previous, [kind]: { ...previous[kind], ...patch } }));

  // 선결정례 토글에서 고른 결과 조건: 선택안함(null), 인용, 기각
  const [wanted, setWanted] = useState<WantedResult>(null);

  // 첫 검색 때 AI가 만든 검색 계획. 다른 토글을 검색할 때 다시 보내 AI 분석을 한 번만 하게 한다.
  const [outOfScope, setOutOfScope] = useState<string | null>(null);
  const [plan, setPlan] = useState<SearchPlan | null>(null);

  // 이미 만든 요약은 기억해 두고 다시 만들지 않는다. (인용·기각을 바꿔 다시 찾을 때 요금을 아낀다)
  const [summaries, setSummaries] = useState<Record<string, CaseSummary>>({});
  const summariesRef = useRef<Record<string, CaseSummary>>({});
  const addSummaries = (list: CaseSummary[]) => {
    summariesRef.current = { ...summariesRef.current, ...Object.fromEntries(list.map((s) => [caseKey(s), s])) };
    setSummaries(summariesRef.current);
  };

  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, DetailState>>({});

  const lastFacts = useRef("");
  // 토글마다 검색을 새로 시작하면 번호가 올라간다. 이전 검색의 답이 늦게 도착해도 화면에 섞이지 않게 한다.
  const requestIds = useRef<Record<Tab, number>>({ law: 0, decision: 0, precedent: 0 });

  /** 로그인이 풀렸으면 로그인 화면으로 돌려보낸다. */
  function handleAuthError(error: unknown): boolean {
    if (error instanceof ApiError && error.code === "unauthorized") {
      onLoggedOut();
      return true;
    }
    return false;
  }

  /** 아직 요약이 없는 사례만 골라 요약을 받아 온다. */
  async function fetchSummaries(items: CaseItem[], limitMs: number) {
    const missing = items.filter((item) => !summariesRef.current[caseKey(item)]?.summary);
    if (missing.length === 0) return;
    const { summaries: list } = await post<{ summaries: CaseSummary[] }>(
      "/api/summarize",
      { items: missing.map(({ kind, id }) => ({ kind, id })) },
      limitMs,
    );
    addSummaries(list);
  }

  /** 한 범위(법령, 선결정례, 법원 판결)만 검색한다. 사례는 이어서 처음 6건의 요약까지 받는다. */
  async function runScope(scope: Tab, text: string, knownPlan: SearchPlan | null, wantedResult: WantedResult) {
    requestIds.current[scope] += 1;
    const id = requestIds.current[scope];
    const isCurrent = () => id === requestIds.current[scope];
    const setStatus = (status: LoadStatus) => (scope === "law" ? setLawStatus(status) : patchCase(scope, { status }));
    setStatus("loading");

    const startedAt = now();
    try {
      const found = await post<SearchResponse>(
        "/api/search",
        { facts: text, scope, plan: knownPlan, wantedResult: scope === "decision" ? wantedResult : null },
        SEARCH_LIMIT_MS,
      );
      if (!isCurrent()) return; // 그 사이 새 검색이 시작됐으면 버린다.

      const items = scope === "law" ? [] : (found.cases ?? []).slice(0, MAX_CASES);
      if (items.length > 0) {
        // 남은 시간 안에 요약까지 끝나야 한다. (검색 전체가 60초 이내)
        const remaining = Math.max(1_000, SEARCH_LIMIT_MS - (now() - startedAt));
        await fetchSummaries(items.slice(0, FIRST_PAGE), remaining);
        if (!isCurrent()) return;
      }

      setPlan(found.plan);
      setOutOfScope(found.outOfScope);

      if (found.outOfScope) {
        // 조세 분야가 아니면 모든 토글을 빈 결과로 끝낸다.
        setLawResult(EMPTY_LAW_RESULT);
        setLawStatus("done");
        setCaseStates({ decision: { ...EMPTY_CASE_STATE, status: "done" }, precedent: { ...EMPTY_CASE_STATE, status: "done" } });
        return;
      }
      if (scope === "law") {
        setLawResult(found.lawResult ?? EMPTY_LAW_RESULT);
        setLawStatus("done");
      } else {
        patchCase(scope, { status: "done", items, notice: found.caseNotice ?? null, visible: FIRST_PAGE, more: "idle" });
      }
    } catch (error) {
      if (!isCurrent()) return;
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

    // 다른 토글에서 진행 중이던 이전 검색의 답은 모두 버린다.
    requestIds.current = { law: requestIds.current.law + 1, decision: requestIds.current.decision + 1, precedent: requestIds.current.precedent + 1 };
    lastFacts.current = trimmed;
    summariesRef.current = {};
    setWarning("");
    setLawStatus("idle");
    setLawResult(EMPTY_LAW_RESULT);
    setLawVisible(FIRST_PAGE);
    setCaseStates({ decision: EMPTY_CASE_STATE, precedent: EMPTY_CASE_STATE });
    setOutOfScope(null);
    setPlan(null);
    setSummaries({});
    setOpenItems({});
    setDetails({});

    void runScope(tab, trimmed, null, wanted);
  }

  /** 토글 전환: 이미 검색한 사실관계가 있고 그 토글을 아직 찾지 않았으면, 그때 그 범위를 검색한다. */
  function selectTab(next: Tab) {
    setTab(next);
    const status = next === "law" ? lawStatus : caseStates[next].status;
    if (lastFacts.current && status === "idle" && !outOfScope) void runScope(next, lastFacts.current, plan, wanted);
  }

  /** 인용·기각·선택안함 고르기: 이미 선결정례를 찾았다면 고른 조건으로 선결정례를 다시 찾는다. */
  function selectWanted(next: WantedResult) {
    if (next === wanted) return;
    setWanted(next);
    if (lastFacts.current && caseStates.decision.status !== "idle" && !outOfScope) void runScope("decision", lastFacts.current, plan, next);
  }

  /** 더보기 (법령): 이미 받아 둔 목록에서 다음 조문을 보여 준다. */
  function showMoreLaws() {
    setLawVisible((count) => Math.min(count + MORE_SIZE, MAX_LAWS));
  }

  /** 더보기 (사례): 다음 5건의 요약을 새로 받아서 보여 준다. */
  async function showMoreCases(kind: CaseTab) {
    const state = caseStates[kind];
    if (state.more === "loading") return;
    const next = state.items.slice(state.visible, state.visible + MORE_SIZE);
    if (next.length === 0) return;

    const id = requestIds.current[kind];
    patchCase(kind, { more: "loading" });
    try {
      await fetchSummaries(next, MORE_LIMIT_MS);
      if (id !== requestIds.current[kind]) return;
      patchCase(kind, { visible: Math.min(state.visible + MORE_SIZE, MAX_CASES), more: "idle" });
    } catch (error) {
      if (id !== requestIds.current[kind]) return;
      if (handleAuthError(error)) return;
      patchCase(kind, { more: "error" });
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
  const caseState = tab === "law" ? null : caseStates[tab];
  const currentStatus = tab === "law" ? lawStatus : caseStates[tab].status;
  const tabCount = (scope: Tab) => {
    if (scope === "law") return lawStatus === "done" ? laws.length : null;
    return caseStates[scope].status === "done" ? caseStates[scope].items.length : null;
  };

  // 결과 위의 안내: 조세 분야가 아닐 때의 문구, 법령의 적용 시점, 인용·기각으로 걸러 냈다는 문구
  const lawBasis = tab === "law" && lawStatus === "done" ? lawResult : null;
  const caseNotice = caseState?.status === "done" ? caseState.notice : null;
  const showInfo = !!outOfScope || !!lawBasis?.basisLabel || !!lawBasis?.notice || !!caseNotice;

  return (
    <div className="flex flex-col gap-4">
      {/* 위쪽 토글 */}
      <div role="tablist" aria-label="결과 종류" className="grid grid-cols-3 overflow-hidden rounded-lg border border-[#1b3a6b]">
        {(["law", "decision", "precedent"] as const).map((scope) => (
          <TabButton key={scope} selected={tab === scope} onClick={() => selectTab(scope)} label={TAB_LABEL[scope]} count={tabCount(scope)} />
        ))}
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

        {/* 선결정례 토글에서만: 결과(인용, 기각) 고르기 */}
        {tab === "decision" && (
          <div role="radiogroup" aria-label="결정 결과" className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">결과</span>
            {WANTED_OPTIONS.map((option) => {
              const selected = wanted === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => selectWanted(option.value)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                    selected ? "border-[#1b3a6b] bg-[#1b3a6b] text-white" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">의뢰인을 알아볼 수 있는 정보는 적지 마세요.</p>
          <button
            type="submit"
            disabled={!facts.trim() || currentStatus === "loading"}
            className="rounded bg-[#1b3a6b] px-5 py-2 font-semibold text-white disabled:opacity-50"
          >
            {currentStatus === "loading" ? "찾는 중…" : `${TAB_LABEL[tab]} 검색`}
          </button>
        </div>
        {warning && (
          <p role="alert" className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warning}
          </p>
        )}
      </form>

      {/* 결과 위의 안내 (쟁점 정리는 화면에 보여 주지 않는다) */}
      {showInfo && currentStatus !== "loading" && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {outOfScope && <p className="text-sm text-slate-700">{outOfScope}</p>}
          {lawBasis?.basisLabel && <p className="text-sm font-semibold text-[#1b3a6b]">{lawBasis.basisLabel}</p>}
          {lawBasis?.notice && <p className="mt-1 text-sm text-slate-600">{lawBasis.notice}</p>}
          {caseNotice && <p className="text-sm text-slate-600">{caseNotice}</p>}
        </section>
      )}

      {/* 검색 중 */}
      {currentStatus === "loading" && (
        <p role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
          {LOADING_TEXT[tab]} 길면 1분까지 걸립니다.
        </p>
      )}

      {/* 조회 실패 또는 60초 초과 */}
      {currentStatus === "error" && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm text-red-800">자료를 불러오지 못했습니다.</p>
          <button
            type="button"
            onClick={() => void runScope(tab, lastFacts.current, plan, wanted)}
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

      {/* 선결정례 또는 법원 판결 결과 */}
      {tab !== "law" && caseState?.status === "done" && !outOfScope && (
        <section aria-label={TAB_LABEL[tab]} className="flex flex-col gap-3">
          {caseState.items.length === 0 && (
            <EmptyMessage text={tab === "decision" ? "관련 선결정례를 찾지 못했습니다." : "관련 법원 판결을 찾지 못했습니다."} />
          )}
          {caseState.items.slice(0, caseState.visible).map((item) => {
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
          {caseState.visible < caseState.items.length && (
            <>
              {caseState.more === "error" && (
                <p role="alert" className="text-center text-sm text-red-700">
                  자료를 불러오지 못했습니다. 아래 버튼으로 다시 시도해 주세요.
                </p>
              )}
              <MoreButton
                onClick={() => void showMoreCases(tab)}
                busy={caseState.more === "loading"}
                label={caseState.more === "error" ? "다시 시도" : "더보기"}
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
