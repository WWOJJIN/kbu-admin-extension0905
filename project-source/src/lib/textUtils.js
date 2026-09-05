// src/lib/textUtils.js
// kbu-assistant(lib/textUtils.js)에서 이식한 규칙 기반 폴백 파서.
// team_plan_summary.docx 6절 "왜 정규식만 쓰지 않고 AI를 쓰나요?" 답변대로,
// 이건 AI(Claude API) 파싱을 대체하는 게 아니라 "AI 파싱 실패/미배포 상태에서
// deadline/requires_action이 항상 null·false로 비어있는 문제"를 메꾸는
// 1차 후보값이다. 프록시가 배포돼서 parseCoopDoc()이 정상적으로 값을 주면
// 그 값을 그대로 쓰고, 이 함수들은 폴백으로만 호출된다
// (extension/background.js의 handleNewCoopDoc 참고).

/**
 * 텍스트에서 마감기한으로 보이는 날짜 하나를 뽑아낸다.
 * 우선순위: "~까지"가 붙은 날짜 > 완전한 날짜(YYYY-MM-DD류)
 * @param {string} text
 * @returns {string|null} YYYY-MM-DD or null
 */
export function extractDeadline(text) {
  if (!text) return null;
  const now = new Date();
  const curYear = now.getFullYear();

  const toIso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // 1) "8/24까지", "8/24(월)까지", "8. 24.까지"
  const withDeadlineWord = text.match(/(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*\.?\s*(?:\([^)]{1,4}\))?\s*까지/);
  if (withDeadlineWord) {
    const m = parseInt(withDeadlineWord[1], 10);
    const d = parseInt(withDeadlineWord[2], 10);
    let year = curYear;
    // 마감월이 현재월보다 훨씬 이전이면(예: 지금 11월인데 2월) 내년으로 추정
    if (m < now.getMonth() + 1 - 6) year += 1;
    return toIso(year, m, d);
  }

  // 2) "8월 24일까지"
  const koreanDeadline = text.match(/(\d{1,2})월\s*(\d{1,2})일\s*까지/);
  if (koreanDeadline) {
    return toIso(curYear, parseInt(koreanDeadline[1], 10), parseInt(koreanDeadline[2], 10));
  }

  // 3) 완전한 날짜: 2026-08-24, 2026.8.24, 2026. 8. 24.
  const fullDate = text.match(/(20\d{2})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/);
  if (fullDate) {
    return toIso(parseInt(fullDate[1], 10), parseInt(fullDate[2], 10), parseInt(fullDate[3], 10));
  }

  return null;
}

// "이 문서는 조교가 뭔가 해야 하는 문서인가?"를 키워드로 1차 판정.
// AI 없이 쓰는 러프한 규칙이라 오탐/누락 있을 수 있음 — 최종 판단은 사람이 함.
//
// ⚠️ 2026-09-02: "처리해야 할 일에 예전 것까지 너무 많이 쌓인다"는 리포트를
// 조사하다 보니, 원인의 상당 부분이 여기 있었다 — "바랍니다"/"확인 바랍니다"/
// "부탁드립니다"/"협조 바랍니다"는 실제로 뭔가 조치가 필요한 문서뿐 아니라
// "참고하시기 바랍니다", "너그러운 양해 부탁드립니다"처럼 순수 공지성 협조문의
// 상투적인 맺음말에도 거의 항상 등장한다. 그래서 AI 파싱 프록시가 아직
// 미배포인 상태에서는 사실상 대부분의 협조문이 requires_action=true로 잘못
// 분류되고 있었을 가능성이 높다 — "처리해야 할 일"이 계속 쌓이기만 하고 줄지
// 않는 것처럼 보인 것도 이 오탐 때문일 수 있음. 이 목록을 실제로 조치가 필요한
// 동사 위주("제출"/"회신"/"신청"/"재상신"/"재제출")로 좁혀서 오탐을 줄인다.
// 정확한 판정은 결국 AI 파싱 프록시가 배포돼야 해결됨(이 함수는 그때까지의
// 1차 후보값일 뿐).
const ACTION_HINTS = [
  "제출", "회신", "신청", "재상신", "재제출", "작성하여 제출", "기한 내 제출",
];

/**
 * 키워드 기반으로 "처리해야 할 일"인지 러프하게 판정한다.
 * @param {string} text
 * @returns {boolean}
 */
export function guessRequiresAction(text) {
  if (!text) return false;
  return ACTION_HINTS.some((kw) => text.includes(kw));
}

/**
 * AI 파싱 결과(parsed)가 없거나 필드가 비어있을 때 규칙 기반 값으로 채운다.
 * AI 값이 있으면 항상 AI 값을 우선한다(폴백이므로 덮어쓰지 않음).
 * @param {{deadline?: string|null, requires_action?: boolean} | null} parsed
 * @param {string} rawText
 * @returns {{deadline: string|null, requires_action: boolean}}
 */
export function fillParsedFallback(parsed, rawText) {
  return {
    deadline: parsed?.deadline ?? extractDeadline(rawText),
    requires_action: parsed?.requires_action ?? guessRequiresAction(rawText),
  };
}
