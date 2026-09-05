// src/lib/claudeApi.js
// Claude API 파싱 함수. 반드시 프록시 서버를 경유해서 호출한다.
// (코딩 규칙: api.anthropic.com 직접 호출 금지, API 키를 확장 코드/manifest에 절대
// 포함하지 않음 — Claude API 호출은 이 파일에서만 수행)
//
// ⚠️ 2026-09-05: 프록시 서버(Cloudflare Worker) 코드는 project-source/proxy/에
// 작성 완료. 배포는 proxy/README.md 절차(Cloudflare 대시보드 수동 배포 — 이 세션
// 환경에서 wrangler CLI가 Cloudflare API에 못 붙어서 대시보드 방식으로 진행)를
// 따를 것. 배포 후 아래 PROXY_URL만 실제 workers.dev 주소로 채우면 나머지 코드는
// 그대로 동작함. PROXY_SECRET은 proxy/.dev.vars 및 Cloudflare 대시보드 시크릿과
// 반드시 동일한 값으로 이미 채워둠(2026-09-05 생성) — 값을 바꾸려면 세 군데
// (여기, proxy/.dev.vars, Cloudflare 대시보드 시크릿)를 같이 바꿔야 함.

const PROXY_URL = "https://kbu-admin-proxy.20250147.workers.dev"; // 2026-09-05 배포 완료(Cloudflare 대시보드)
const PROXY_SECRET_HEADER = "x-proxy-secret";
const PROXY_SECRET = "b7f00dd4f162baf019d3cae3969d4ee7e85f10f05c13f4a607545d671857e9bc";

const SYSTEM_PROMPT = "대학 행정 협조문 분석 어시스턴트. JSON만 반환. 다른 텍스트 없음.";

/**
 * @typedef {Object} ParsedCoopDoc
 * @property {string} title
 * @property {string} sender_dept
 * @property {string|null} deadline  YYYY-MM-DD or null
 * @property {boolean} requires_action
 * @property {string|null} action_description
 * @property {string} summary  3줄 요약
 */

/**
 * 협조문 원문을 프록시 경유 Claude API로 파싱한다.
 * 실패 시 1회 재시도, 그래도 실패하면 에러를 던진다 (에러 토스트 표시는 호출부 책임).
 * @param {string} rawText
 * @returns {Promise<ParsedCoopDoc>}
 */
export async function parseCoopDoc(rawText) {
  if (!PROXY_URL) {
    throw new Error(
      "[claudeApi] 프록시 서버 URL이 아직 설정되지 않음 (proxy/ 배포 후 PROXY_URL을 채울 것)"
    );
  }
  return callProxyWithRetry(rawText, 1);
}

async function callProxyWithRetry(rawText, retries) {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PROXY_SECRET_HEADER]: PROXY_SECRET,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        system: SYSTEM_PROMPT,
        text: rawText,
      }),
    });
    if (!res.ok) throw new Error(`프록시 요청 실패: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return normalizeParsedDoc(data);
  } catch (err) {
    if (retries > 0) {
      return callProxyWithRetry(rawText, retries - 1);
    }
    throw err;
  }
}

/**
 * 프록시(Claude API) 응답을 CoopDoc 스키마에 맞는 형태로 정규화.
 * 필드 누락 시 안전한 기본값으로 채워서 저장 단계에서 undefined가 안 들어가게 함.
 * @param {Object} data
 * @returns {ParsedCoopDoc}
 */
function normalizeParsedDoc(data) {
  return {
    title: data?.title ?? "",
    sender_dept: data?.sender_dept ?? "",
    deadline: data?.deadline ?? null,
    requires_action: Boolean(data?.requires_action),
    action_description: data?.action_description ?? null,
    summary: data?.summary ?? "",
  };
}
