// 요약에 보낼 글 고르기: 결정문에서 "판단" 부분을 찾아, 개요와 함께 AI에게 보낼 글을 만든다.
//
// 결정문은 "처분개요 → 청구인 주장 → 처분청 의견 → 심리 및 판단(쟁점, 관련 법령, 사실관계, 판단) → 결론 → 별지" 순서다.
// 예전에는 본문 앞부분만 잘라 보냈는데, 최근 결정문은 길어서(중간값 약 1만 자) 맨 뒤쪽에 있는 판단 부분이 잘려 나갔다.
// 그래서 요약이 청구인 주장과 결론 문구 위주가 되었다. 여기서는 판단 부분을 찾아 반드시 들어가게 한다.
//
// 이 파일은 다른 코드 파일을 불러오지 않는다. AI를 쓰지 않는 순수한 계산이라 요금 없이 따로 시험할 수 있다.

const WHOLE_LIMIT = 6500; // 이보다 짧은 본문은 통째로 보낸다.
const OVERVIEW_LENGTH = 1300; // 긴 본문에서 앞부분(처분개요)으로 보낼 글자 수
const JUDGMENT_LIMIT = 5200; // 판단 부분으로 보낼 글자 수 한도
const CONCLUSION_LENGTH = 260; // "결론" 제목 뒤로 함께 보낼 글자 수 (주문과 같이 결정한다는 문장)
const HEAD_LIMIT = 1500; // 사건명·주문·재결요지 등 앞머리 한도

const CONCLUSION = /\d\s*\.\s*결\s*론/g; // "4. 결론"
const JUDGMENT_HEADING = /심리\s*및\s*판단|사실관계\s*및\s*판단/g;
// 판단이 시작될 때 쓰는 표현
const JUDGMENT_START = /살피건대|살펴보건대|살피건데|살펴보건데|살펴본다|살펴보면|판단하건대|보건대/g;

const lastIndex = (text: string, pattern: RegExp, before = Infinity): number => {
  let found = -1;
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) < before) found = match.index ?? -1;
  }
  return found;
};

/** 본문(이유)에서 판단 부분이 시작하는 자리와 끝나는 자리(결론 제목)를 찾는다. */
export function findJudgment(reason: string): { start: number; end: number; foundStart: boolean } {
  const conclusion = lastIndex(reason, CONCLUSION);
  const end = conclusion >= 0 ? conclusion : reason.length; // 옛 결정문에는 결론 제목이 없다. 그때는 글의 끝까지 본다.
  const heading = lastIndex(reason, JUDGMENT_HEADING, end);

  // "판단" 제목 뒤에서 처음 나오는 "살피건대" 같은 표현이 판단의 시작이다.
  let start = -1;
  for (const match of reason.matchAll(JUDGMENT_START)) {
    const at = match.index ?? 0;
    if (at > Math.max(heading, 0) && at < end) {
      start = at;
      break;
    }
  }
  if (start >= 0) return { start: Math.max(0, start - 150), end, foundStart: true };
  // 시작 표현을 못 찾으면 결론 바로 앞 부분을 판단으로 본다.
  return { start: Math.max(0, end - 3500), end, foundStart: false };
}

/** 가운데를 줄여 한도 안에 맞춘다. 앞과 뒤를 남긴다. (판단의 결론은 뒤쪽에 있으므로 뒤를 더 남긴다) */
function squeeze(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.45);
  return `${text.slice(0, head)}\n(중략)\n${text.slice(text.length - (limit - head))}`;
}

/** 전문에서 "【제목】\n" 뒤의 내용을 꺼낸다. 없으면 null. */
function splitAt(fullText: string, heading: string): { before: string; after: string } | null {
  const marker = `【${heading}】\n`;
  const at = fullText.indexOf(marker);
  if (at < 0) return null;
  return { before: fullText.slice(0, at).trim(), after: fullText.slice(at + marker.length) };
}

/**
 * AI에게 요약을 시킬 글을 만든다.
 * 결정례: 앞머리(사건명·주문·재결요지) + 개요 + 판단 부분. 판결: 앞머리(판시사항·판결요지) + 판결문의 앞과 뒤.
 */
export function pickSummaryText(kind: "decision" | "precedent", fullText: string): string {
  if (kind === "precedent") {
    const parts = splitAt(fullText, "판결문");
    if (!parts) return squeeze(fullText, WHOLE_LIMIT + HEAD_LIMIT);
    // 판결문은 뒤쪽에 판단과 결론이 있으므로 앞과 뒤를 남긴다.
    return `${squeeze(parts.before, HEAD_LIMIT + 500)}\n\n【판결문】\n${squeeze(parts.after, WHOLE_LIMIT)}`;
  }

  const parts = splitAt(fullText, "이유");
  if (!parts) return squeeze(fullText, WHOLE_LIMIT + HEAD_LIMIT);
  const head = squeeze(parts.before, HEAD_LIMIT);
  // 맨 뒤의 관련법령 항목은 요약에 필요 없으므로 뺀다.
  const lawAt = parts.after.lastIndexOf("\n\n【관련법령】");
  const reason = lawAt >= 0 ? parts.after.slice(0, lawAt) : parts.after;

  const { start, end } = findJudgment(reason);
  const stop = Math.min(reason.length, end + CONCLUSION_LENGTH); // 결론 뒤의 별지(법령 전문)는 보내지 않는다.

  // 짧은 본문은 통째로 보낸다.
  if (stop <= WHOLE_LIMIT) return `${head}\n\n【이유】\n${reason.slice(0, stop)}`;

  const overview = reason.slice(0, Math.min(OVERVIEW_LENGTH, start));
  const judgment = squeeze(reason.slice(start, stop), JUDGMENT_LIMIT);
  return `${head}\n\n【개요 (본문 앞부분)】\n${overview}\n(중략: 청구인 주장, 처분청 의견, 관련 법령)\n\n【판단 (조세심판원의 판단과 결론)】\n${judgment}`;
}
