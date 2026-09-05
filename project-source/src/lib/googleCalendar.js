// src/lib/googleCalendar.js
// kbu-assistant(js/app.js)의 getGoogleAuthToken / createGoogleCalendarEvent를
// 그대로 이식. chrome.identity는 background(service worker)뿐 아니라 확장
// 페이지(이 React 앱이 열리는 dist/index.html 탭)에서도 그대로 쓸 수 있다.
//
// 전제조건: extension/manifest.json에 identity 권한 + oauth2.client_id +
// googleapis host_permission이 있어야 함 (2단계 작업으로 함께 추가됨).

/**
 * 구글 OAuth 토큰을 가져온다.
 * @param {boolean} interactive true면 필요 시 로그인/동의 화면을 띄움
 * @returns {Promise<string>}
 */
export async function getGoogleAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.identity) {
      reject(new Error("chrome.identity를 사용할 수 없는 환경입니다 (확장프로그램 컨텍스트가 아님)."));
      return;
    }
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError || new Error("토큰을 가져오지 못했습니다"));
        return;
      }
      resolve(token);
    });
  });
}

/**
 * date(YYYY-MM-DD)의 다음 날짜를 YYYY-MM-DD로 반환한다.
 * ⚠️ 2026-09-02 버그 수정: Google Calendar API는 종일(all-day) 이벤트의
 * end.date를 "배타적(exclusive)" 날짜로 취급한다 — 하루짜리 일정이어도
 * end.date는 시작일의 "다음 날"이어야 한다(공식 문서/예제 전부 start+1일을
 * end로 씀). 예전 코드는 start와 end를 같은 날짜로 보내서 기간이 0일짜리
 * 일정이 되어버렸음 — 등록은 되더라도 캘린더에 해당 날짜에 정상적으로
 * 표시가 안 되거나 하루 당겨져 보일 위험이 있었음.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string} YYYY-MM-DD
 */
function nextDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // UTC 기준으로 계산해서 로컬 타임존에 따른 날짜 밀림을 방지
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(dt.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

/**
 * 구글 캘린더에 종일(all-day) 일정을 등록한다.
 * @param {{title: string, date: string, description?: string}} params date는 YYYY-MM-DD
 * @returns {Promise<Object>} 생성된 이벤트 리소스
 */
export async function createGoogleCalendarEvent({ title, date, description }) {
  const token = await getGoogleAuthToken(true);
  const event = {
    summary: title,
    description,
    start: { date }, // 종일 이벤트 (YYYY-MM-DD)
    end: { date: nextDateStr(date) }, // end.date는 배타적 — 마감일 다음 날을 넣어야 함
  };
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`캘린더 등록 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

/**
 * 만료/무효 토큰 캐시를 지운다 (등록 실패 후 재시도 시 새 토큰을 강제로 받고 싶을 때 사용).
 * @param {string} token
 */
export async function removeCachedToken(token) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.identity || !token) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}
