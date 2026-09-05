// src/lib/claudeApi.js
// Claude API 파싱 함수. 반드시 프록시 서버를 경유해서 호출한다.
// (코딩 규칙: api.anthropic.com 직접 호출 금지, API 키를 확장 코드/manifest에 절대
// 포함하지 않음 — Claude API 호출은 이 파일에서만 수행)
//
// ⚠️ 2026-08-08 기준 프록시 서버(Cloudflare Worker, proxy/)는 아직 배포 전이다
// (재료비/예산 승인 대기 중이라 보류). PROXY_URL이 비어있는 동안 parseCoopDoc()은
// 명확한 에러를 던지도록 해뒀다. 프록시 배포되면 PROXY_URL/PROXY_SECRET만 채우면
// 나머지 코드는 그대로 동작함.

const PROXY_URL = ""; // TODO: 프록시 배포 후 채울 것 (예: https://xxx.workers.dev/parse)
const PROXY_SECRET_HEADER = "x-proxy-secret";
const PROXY_SECRET = ""; // TODO: wrangler secret으로 등록한 값과 맞춰서 채울 것

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
