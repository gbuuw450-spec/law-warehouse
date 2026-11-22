// 사건번호 알아보기: 검색창에 "조심 2019중1999"처럼 사건번호를 적으면, AI를 거치지 않고 그 번호로 바로 찾는다.
//
// 이 파일은 다른 코드 파일을 불러오지 않는다. AI를 쓰지 않는 순수한 계산이라 요금 없이 따로 시험할 수 있다.

// 연도 4자리 + 한글 1~3자 + 숫자. 예: 2019중1999, 2012서4668, 2019두12345, 2020구합1234
const CASE_NUMBER = /(\d{4})\s*-?\s*([가-힣]{1,3})\s*-?\s*(\d{2,6})/g;
// "2021년 12월", "2019원 100" 같은 날짜·금액 표현은 사건번호가 아니다.
const NOT_CASE_LETTERS = /[년월일원호조항건개명만억천백번차기]/;
// 사건번호 앞뒤에 흔히 붙는 말. 이것만 남아 있으면 "사건번호만 적은 것"으로 본다.
const FILLER = /(조심|국심|심사|감심|대법원|고등법원|행정법원|지방법원|법원|사건번호|사건|번호|판결|결정|선고|찾아줘|찾아|검색|알려줘)/g;

/** 사건번호 비교용: 띄어쓰기와 기호를 없앤다. */
export const normalizeCaseNumber = (value: string): string => value.replace(/[\s\-·.]/g, "");

/** 글에서 사건번호를 모두 찾아 "2019중1999" 모양으로 돌려준다. (최대 5개) */
export function findCaseNumbers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CASE_NUMBER)) {
    if (NOT_CASE_LETTERS.test(match[2])) continue;
    const number = `${match[1]}${match[2]}${match[3]}`;
    if (!found.includes(number)) found.push(number);
    if (found.length >= 5) break;
  }
  return found;
}

/** 글이 사건번호만으로 이루어져 있는지. (사건번호와 "조심", "사건번호" 같은 말만 있으면 true) */
export function isOnlyCaseNumbers(text: string): boolean {
  if (findCaseNumbers(text).length === 0) return false;
  const rest = text.replace(CASE_NUMBER, "").replace(FILLER, "").replace(/[\s,./·()\[\]:;'"?!-]/g, "");
  return rest.length <= 4;
}
