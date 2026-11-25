// 본문 확인: 결정 본문에서 사용자가 적은 핵심 표현("기존임대주택", "2005.1.5", "제3조 제1항 제3호" 등)이
// 나오는 대목을 찾아 뽑는다. 사건명과 재결요지에는 없고 본문에만 있는 내용을 AI가 볼 수 있게 하려는 것이다.
//
// 이 파일은 다른 코드 파일을 불러오지 않는다. AI를 쓰지 않는 순수한 계산이라 요금 없이 따로 시험할 수 있다.

const SNIPPET_BEFORE = 70; // 찾은 자리 앞쪽으로 보여 줄 글자 수
const SNIPPET_AFTER = 150; // 찾은 자리 뒤쪽으로 보여 줄 글자 수
const MAX_HITS_PER_TERM = 40; // 한 표현을 본문에서 찾는 횟수 한도

// 표기 차이를 없애는 규칙 (결정문마다 같은 내용을 다르게 적기 때문)
//  - 날짜: "2005년 1월 5일", "2005. 1. 5.", "2005.01.05" → "2005.1.5"
//  - 조문: "제3조 제1항 제3호", "제3조제1항제3호", "3조 1항 3호" → "3조1항3호"
//  - 띄어쓰기와 괄호·따옴표 같은 기호는 없앤다.
const NORMALIZE =
  /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?|제(?=\s*\d)|[\s·ㆍ,「」『』()\[\]"'‘’“”<>〈〉]/g;

/** 글을 비교용으로 바꾸고, 바뀐 글의 각 글자가 원래 글의 어디였는지도 함께 돌려준다. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let last = 0;
  const copy = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) {
      out.push(text[i].toLowerCase());
      map.push(i);
    }
  };
  for (const match of text.matchAll(NORMALIZE)) {
    const at = match.index ?? 0;
    copy(last, at);
    const year = match[1] ?? match[4];
    if (year) {
      const date = `${year}.${Number(match[2] ?? match[5])}.${Number(match[3] ?? match[6])}`;
      for (const ch of date) {
        out.push(ch);
        map.push(at);
      }
    }
    last = at + match[0].length;
  }
  copy(last, text.length);
  return { norm: out.join(""), map };
}

/** 본문 확인 결과 */
export interface BodyMatch {
  /** 본문에서 찾은 핵심 표현들 */
  matched: string[];
  /** 찾은 횟수의 합 */
  hits: number;
  /** 핵심 표현이 가장 많이 모여 있는 대목 (원문 그대로). 하나도 없으면 빈 글자 */
  snippet: string;
}

/** 본문에서 핵심 표현을 찾고, 표현이 가장 많이 모여 있는 대목을 뽑는다. */
export function matchBody(body: string, terms: string[]): BodyMatch {
  const { norm, map } = normalizeWithMap(body);
  const found: { term: number; at: number }[] = [];
  const matched: string[] = [];

  terms.forEach((term, termIndex) => {
    const needle = normalizeWithMap(term).norm;
    if (needle.length < 2) return;
    let from = 0;
    let count = 0;
    while (count < MAX_HITS_PER_TERM) {
      const at = norm.indexOf(needle, from);
      if (at < 0) break;
      found.push({ term: termIndex, at: map[at] });
      count += 1;
      from = at + needle.length;
    }
    if (count > 0) matched.push(term);
  });
  if (found.length === 0) return { matched: [], hits: 0, snippet: "" };

  // 찾은 자리마다 그 주변에 서로 다른 표현이 몇 개 있는지 세어, 가장 많은 자리를 고른다.
  let best = found[0];
  let bestCount = 0;
  for (const anchor of found) {
    const start = anchor.at - SNIPPET_BEFORE;
    const end = anchor.at + SNIPPET_AFTER;
    const count = new Set(found.filter((hit) => hit.at >= start && hit.at <= end).map((hit) => hit.term)).size;
    if (count > bestCount || (count === bestCount && anchor.at < best.at)) {
      best = anchor;
      bestCount = count;
    }
  }
  const snippet = body
    .slice(Math.max(0, best.at - SNIPPET_BEFORE), best.at + SNIPPET_AFTER)
    .replace(/\s+/g, " ")
    .trim();
  return { matched, hits: found.length, snippet };
}
