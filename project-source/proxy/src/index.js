// project-source/proxy/src/index.js
// KBU 행정 어시스턴트 — 협조문 파싱 프록시 (Cloudflare Worker)
//
// 역할: Chrome 확장(src/lib/claudeApi.js)이 보낸 { model, system, text }를 받아
// 이 Worker가 대신 Anthropic Claude API를 호출하고, 결과를 ParsedCoopDoc 스키마
// (title/sender_dept/deadline/requires_action/action_description/summary) 그대로
// JSON으로 돌려준다. 실제 ANTHROPIC_API_KEY는 이 Worker의 비밀 환경변수로만
// 존재하고 확장 코드/manifest에는 절대 들어가지 않는다(코딩 규칙 준수 — api.anthropic.com
// 직접 호출 금지는 "확장에서"라는 뜻이고, 이 프록시 자체가 그 호출을 대신 해주는 역할).
//
// 호출 측 인증: x-proxy-secret 헤더가 PROXY_SECRET 시크릿과 일치해야 함. 강력한
// 인증은 아니고(확장 번들 JS 안에 평문으로 들어있는 값이라 완전한 비밀은 아님),
// 아무나 이 엔드포인트를 두드려 Claude API 비용을 발생시키는 걸 막는 최소한의
// 게이트 역할만 한다.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_MODEL = "claude-haiku-4-5";

const CORS_HEADERS = {
  // 확장 백그라운드(service worker)에서 fetch할 때 manifest.json host_permissions에
  // 이 Worker 도메인이 없으면 CORS에 걸릴 수 있어서, 응답 쪽에서도 명시적으로
  // 허용해둔다(이중 안전장치 — host_permissions도 배포 후 채워 넣을 것).
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-secret",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POST만 지원합니다." }, 405);
    }

    const providedSecret = request.headers.get("x-proxy-secret") || "";
    if (!env.PROXY_SECRET || providedSecret !== env.PROXY_SECRET) {
      return jsonResponse({ error: "인증 실패 (x-proxy-secret 불일치)" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "잘못된 JSON 요청 본문" }, 400);
    }

    const { model, system, text } = body || {};
    if (!text || typeof text !== "string") {
      return jsonResponse({ error: "text 필드(문자열)가 필요합니다." }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: "서버에 ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다." },
        500
      );
    }

    try {
      const parsed = await callClaude({
        apiKey: env.ANTHROPIC_API_KEY,
        model: model || DEFAULT_MODEL,
        system: system || "JSON만 반환하세요.",
        text,
      });
      return jsonResponse(parsed, 200);
    } catch (err) {
      console.error("[proxy] Claude 호출/파싱 실패:", err);
      return jsonResponse({ error: String(err?.message || err) }, 502);
    }
  },
};

/**
 * Anthropic Messages API를 호출하고, 응답 텍스트에서 JSON을 뽑아 반환한다.
 */
async function callClaude({ apiKey, model, system, text }) {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: text }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    // Anthropic 쪽 에러(예: 잔액 부족, 모델명 오타, 레이트리밋)를 그대로 노출해서
    // claudeApi.js/토스트에서 원인 파악이 되게 한다.
    throw new Error(data?.error?.message || `Anthropic API 오류 (HTTP ${res.status})`);
  }

  const rawText = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return extractJson(rawText);
}

/**
 * 시스템 프롬프트로 "JSON만 반환"을 지시하지만, 혹시 ```json 코드펜스나 앞뒤
 * 설명이 섞여 와도 견고하게 파싱되도록 방어적으로 처리한다.
 * @param {string} rawText
 */
function extractJson(rawText) {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : cleaned;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Claude 응답을 JSON으로 파싱하지 못함: ${err.message} (원본 앞부분: ${rawText.slice(0, 200)})`
    );
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
