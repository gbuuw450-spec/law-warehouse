// 화면(브라우저)과 서버가 함께 쓰는 자료 모양을 정의한다.

/** 사례의 종류: 조세심판원 결정례 또는 법원 판결 */
export type CaseKind = "decision" | "precedent";

/** 검색 결과로 보여 줄 법령 조문 한 건 */
export interface LawArticle {
  /** 법령 이름 (예: 국세기본법) */
  lawName: string;
  /** 화면에 보여 줄 조문 이름 (예: 제55조(불복)) */
  articleLabel: string;
  /** 이 조문이 사례와 관련된 이유 1문장 (AI 작성) */
  reason: string;
  /** 조문 전문 (법제처 API에서 받은 내용 그대로) */
  text: string;
  /** 이 조문 내용의 시행일자 (YYYYMMDD) */
  effectiveDate: string;
  /** true면 입력한 시점 기준 조문, false면 현행 조문 */
  historical: boolean;
}

/** 검색 결과로 보여 줄 사례 한 건 (요약은 따로 받아 온다) */
export interface CaseItem {
  kind: CaseKind;
  /** 법제처 API의 일련번호 (본문 조회에 사용) */
  id: string;
  /** 사건번호 (결정례는 청구번호) */
  caseNumber: string;
  /** 사건명 */
  title: string;
  /** 선고일자 또는 의결일자 (YYYYMMDD) */
  date: string;
  /** 자료 출처 (조세심판원, 대법원, 국세법령정보시스템 등) */
  source: string;
  /** 목록에서 이미 알 수 있는 결과 (없으면 빈 글자) */
  resultFromList: string;
}

/** 사례 한 건의 요약 결과 */
export interface CaseSummary {
  kind: CaseKind;
  id: string;
  /** 요약 (3문장 이내). 본문을 받을 수 없으면 null */
  summary: string | null;
  /** 결과 (인용, 기각, 국승 등). 알 수 없으면 "결과 미확인" */
  result: string;
  /** 본문을 법제처 API에서 받을 수 있었는지 */
  hasBody: boolean;
}

/** 검색 범위: 법령, 선결정례(조세심판원 결정례), 법원 판결. 화면에서 고른 토글에 해당하는 쪽만 검색한다. */
export type SearchScope = "law" | "decision" | "precedent";

/** AI가 제안한 법령 조문 후보 (법제처 API로 확인하기 전) */
export interface LawCandidate {
  lawName: string;
  articleNo: number;
  branchNo: number;
  /** AI가 기억하는 조문 제목. 번호가 바뀌었을 때 제목으로 다시 찾는 데 쓴다. */
  title: string;
  reason: string;
}

/**
 * 검색 계획: AI가 사실관계를 분석한 결과.
 * 첫 검색 때 만들어 화면이 기억해 두었다가, 다른 토글을 검색할 때 다시 보내 AI 분석을 한 번만 하게 한다.
 */
export interface SearchPlan {
  /** 조세 분야 질문인지 */
  isTax: boolean;
  /** 쟁점 정리 (2문장 이내) */
  issue: string;
  /** 사례 검색어 */
  keywords: string[];
  lawCandidates: LawCandidate[];
  /** 기준일 YYYYMMDD. 시점이 하나로 명확할 때만 */
  baseDate: string | null;
  /** 시점 상태: none(없음), clear(명확), unclear(불명확하거나 여러 개) */
  dateStatus: "none" | "clear" | "unclear";
  /** "가장 최근" 같은 조건이 있는지 */
  latestFirst: boolean;
}

/** 선결정례 토글에서 사용자가 고른 결과 조건. accepted는 인용, rejected는 기각, null은 선택 안 함(결과와 상관없이 찾기) */
export type WantedResult = "accepted" | "rejected" | null;

/** 법령 검색 결과 */
export interface LawResult {
  /** 적용 시점 표시 (예: "현행 법령 기준", "2026.01.31. 기준") */
  basisLabel: string;
  /** 시점에 대한 안내 문구 (없으면 null) */
  notice: string | null;
  laws: LawArticle[];
}

/** 검색 창구가 돌려주는 내용. 요청한 범위의 결과만 들어 있다. */
export interface SearchResponse {
  /** 쟁점 정리 (2문장 이내) */
  issue: string;
  /** 조세 분야가 아닐 때의 안내 문구 (조세 분야면 null) */
  outOfScope: string | null;
  /** 다른 토글을 검색할 때 다시 보낼 검색 계획 */
  plan: SearchPlan;
  /** 법령 범위를 검색했을 때만 들어 있다. */
  lawResult?: LawResult;
  /** 선결정례 또는 법원 판결 범위를 검색했을 때만 들어 있다. */
  cases?: CaseItem[];
  /** 결과 조건(인용만, 기각만)으로 걸러 냈을 때의 안내 문구. 없으면 null */
  caseNotice?: string | null;
}

/** 본문 조회 창구가 돌려주는 내용 */
export interface DetailResponse {
  /** 전문. 받을 수 없으면 null */
  text: string | null;
  /** 원문을 볼 수 있는 페이지 주소 (인증값이 들어 있지 않은 주소만) */
  originalUrl: string | null;
}

/** 서버가 오류를 알릴 때 쓰는 모양 */
export interface ErrorResponse {
  error: "unauthorized" | "privacy" | "timeout" | "failed" | "bad_request" | "locked" | "wrong_password";
  message: string;
}
