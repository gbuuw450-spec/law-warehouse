// 결과로 걸러 내기: 사용자가 "인용 사례만" 또는 "기각 사례만" 찾아 달라고 했을 때, 다른 결과의 사례를 뺀다.
//
// 결과는 AI가 판단하지 않고, 법제처가 준 본문의 "주문"(예: "심판청구를 기각한다.")에 적힌 낱말로만 판단한다.
// (법제처 목록에는 결과가 없고, 본문을 열어야 주문을 알 수 있다)
// 이 파일은 다른 코드 파일을 불러오지 않는다. AI를 쓰지 않는 순수한 계산이라 요금 없이 따로 시험할 수 있다.

import type { WantedResult } from "./types";

/** 주문에서 읽어 낸 결과: 인용(일부 포함), 기각(각하 포함), 알 수 없음 */
export type Outcome = "accepted" | "rejected" | "unknown";

// 납세자의 주장이 (일부라도) 받아들여졌음을 뜻하는 낱말
const ACCEPTED = /(취소|경정|재조사|인용|국패|패소)/;
// 납세자의 주장이 받아들여지지 않았음을 뜻하는 낱말
const REJECTED = /(기각|각하|국승|승소)/;

/**
 * 조세심판원 결정례의 주문을 읽어 결과를 판단한다.
 * "…처분을 취소하고 나머지 청구는 기각한다"처럼 둘 다 있으면 일부인용이므로 인용 쪽으로 본다.
 */
export function outcomeFromDecisionOrder(order: string): Outcome {
  const text = order.replace(/\s+/g, "");
  if (!text) return "unknown";
  if (ACCEPTED.test(text)) return "accepted";
  if (REJECTED.test(text)) return "rejected";
  return "unknown";
}

/**
 * 법원 판결은 법제처가 "처분청 패소"처럼 결과를 따로 적어 준 경우에만 판단한다.
 * 주문("상고를 기각한다")만으로는 누가 이겼는지 알 수 없어 판단하지 않는다.
 */
export function outcomeFromVerdictType(verdictType: string): Outcome {
  if (/(국패|처분청\s*패소|납세자\s*승소)/.test(verdictType)) return "accepted";
  if (/(국승|처분청\s*승소|납세자\s*패소)/.test(verdictType)) return "rejected";
  return "unknown";
}

/** 이 결과가 사용자가 원하는 결과인지. 결과를 알 수 없으면 원하는 결과라고 볼 수 없으므로 false다. */
export function matchesWantedResult(outcome: Outcome, wanted: WantedResult): boolean {
  if (!wanted) return true; // 조건이 없으면 모두 통과
  return outcome === wanted;
}

/** 화면에 보여 줄 안내 문구. 조건이 없으면 null */
export function describeWantedResult(wanted: WantedResult): string | null {
  if (wanted === "accepted") return "인용 사례만 표시했습니다. (일부인용·경정·취소·재조사 포함. 기각·각하 사례와 결과를 확인할 수 없는 판결은 제외)";
  if (wanted === "rejected") return "기각 사례만 표시했습니다. (각하 포함. 인용·일부인용 사례와 결과를 확인할 수 없는 판결은 제외)";
  return null;
}
