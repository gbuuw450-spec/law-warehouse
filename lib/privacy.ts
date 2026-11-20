// 개인정보 검사: 입력에 주민등록번호나 사업자등록번호 형태의 숫자가 있는지 확인한다.
// 화면(전송 전)과 서버(전송 받은 직후) 양쪽에서 같은 검사를 쓴다.

// 주민등록번호: 6자리 - 7자리 (뒷자리 첫 숫자는 1~8), 줄표나 띄어쓰기가 없어도 잡는다.
const RESIDENT_NUMBER = /(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)/;
// 사업자등록번호: 3자리-2자리-5자리 (줄표가 있는 형태만 잡는다. 줄표 없는 10자리는 다른 숫자와 구분할 수 없다)
const BUSINESS_NUMBER = /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/;

/** 걸리는 것이 있으면 경고 문구를, 없으면 null을 돌려준다. */
export function findPersonalInfo(text: string): string | null {
  if (RESIDENT_NUMBER.test(text)) {
    return "주민등록번호로 보이는 숫자가 있습니다. 지우고 다시 검색해 주세요.";
  }
  if (BUSINESS_NUMBER.test(text)) {
    return "사업자등록번호로 보이는 숫자가 있습니다. 지우고 다시 검색해 주세요.";
  }
  return null;
}
