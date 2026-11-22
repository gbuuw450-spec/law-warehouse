// 같은 결정 묶기: 사건명이 사실상 같은 사례가 여러 건이면 가장 최근 것 한 건만 남긴다.
// (예: 같은 날 같은 쟁점으로 나온 결정 3건이 목록의 세 자리를 차지하는 것을 막는다)
//
// 이 파일은 다른 코드 파일을 불러오지 않는다. AI를 쓰지 않는 순수한 계산이라 요금 없이 따로 시험할 수 있다.

import type { CaseItem } from "./types";

const LONG_TITLE_MIN = 15; // 이 글자 수 이상인 사건명은 "거의 같음"도 같은 결정으로 본다.
// 사건명이 이 정도 비슷하면 같은 결정으로 본다. 띄어쓰기나 조사 한두 글자 차이만 허용하는 높은 기준이다.
// ("가공세금계산서를 수취한"과 "발급한"처럼 낱말이 다른 사건명은 서로 다른 쟁점일 수 있어 묶지 않는다)
const SAME_TITLE_MIN = 0.95;

/** 사건명 비교용: 끝의 결과 괄호("(기각)")와 띄어쓰기, 기호를 없앤다. */
function normalizeTitle(title: string): string {
  return title
    .replace(/\(([^()]{1,12})\)\s*$/, "")
    .replace(/[\s·ㆍ・,.()\[\]「」『』'"]/g, "");
}

/** 두 글이 얼마나 비슷한지 0~1로 돌려준다. (두 글자씩 겹치는 정도) */
function similarity(x: string, y: string): number {
  if (x === y) return 1;
  const pairs = (s: string) => Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2));
  const xp = pairs(x);
  const yp = pairs(y);
  if (xp.length === 0 || yp.length === 0) return 0;
  const remaining = [...yp];
  let hits = 0;
  for (const p of xp) {
    const at = remaining.indexOf(p);
    if (at >= 0) {
      hits += 1;
      remaining.splice(at, 1);
    }
  }
  return (2 * hits) / (xp.length + yp.length);
}

/** 두 사례가 같은 결정으로 볼 만큼 사건명이 같은지 판단한다. */
function isSameDecision(a: CaseItem, aTitle: string, b: CaseItem, bTitle: string): boolean {
  if (a.kind !== b.kind || !aTitle || !bTitle) return false;
  // 결과가 서로 다르면(한쪽은 인용, 한쪽은 기각) 사건명이 같아도 다른 결정이므로 둘 다 남긴다.
  if (a.resultFromList && b.resultFromList && a.resultFromList !== b.resultFromList) return false;
  if (aTitle === bTitle) {
    // 긴 사건명이 완전히 같으면 같은 결정이다.
    // "가공거래 여부"처럼 짧고 흔한 사건명은 서로 다른 사건일 수 있으므로, 날짜까지 같을 때만 같은 결정으로 본다.
    return aTitle.length >= LONG_TITLE_MIN || a.date === b.date;
  }
  // 사건명이 길고 거의 같으면(띄어쓰기나 조사만 다른 정도) 같은 결정으로 본다.
  return aTitle.length >= LONG_TITLE_MIN && bTitle.length >= LONG_TITLE_MIN && similarity(aTitle, bTitle) >= SAME_TITLE_MIN;
}

/**
 * 같은 결정이 여러 건이면 가장 최근 것 한 건만 남긴다.
 * 남긴 사례는 그 묶음에서 가장 앞에 있던 자리에 둔다. (목록의 순서는 그대로 유지)
 */
export function keepLatestOfSameDecisions(items: CaseItem[]): CaseItem[] {
  const groups: { title: string; best: CaseItem }[] = [];
  for (const item of items) {
    const title = normalizeTitle(item.title);
    const group = groups.find((g) => isSameDecision(g.best, g.title, item, title));
    if (!group) {
      groups.push({ title, best: item });
    } else if (item.date > group.best.date) {
      group.best = item; // 더 최근 것으로 바꾼다. 자리는 그대로.
    }
  }
  return groups.map((g) => g.best);
}
