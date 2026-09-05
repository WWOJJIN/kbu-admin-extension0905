// project-source/proxy/src/index.js
// KBU 행정 어시스턴트 — 협조문 파싱 프록시 (Cloudflare Worker)
//
// 역할: Chrome 확장(src/lib/claudeApi.js)이 보낸 { model, system, text, doc_id }를
// 받아 이 Worker가 대신 Anthropic Claude API를 호출하고, 결과를 ParsedCoopDoc
// 스키마(title/sender_dept/deadline/requires_action/action_description/summary)
// 그대로 JSON으로 돌려준다. 실제 ANTHROPIC_API_KEY는 이 Worker의 비밀 환경변수로만
// 존재하고 확장 코드/manifest에는 절대 들어가지 않는다(코딩 규칙 준수 — api.anthropic.com
// 직접 호출 금지는 "확장에서"라는 뜻이고, 이 프록시 자체가 그 호출을 대신 해주는 역할).
//
// 호출 측 인증: x-proxy-secret 헤더가 PROXY_SECRET 시크릿과 일치해야 함. 강력한
// 인증은 아니고(확장 번들 JS 안에 평문으로 들어있는 값이라 완전한 비밀은 아님),
// 아무나 이 엔드포인트를 두드려 Claude API 비용을 발생시키는 걸 막는 최소한의
// 게이트 역할만 한다.
//
// 2026-09-05 추가: doc_id 기반 캐싱. 같은 협조문을 여러 직원(=여러 확장 인스턴스)
// 이 각자 폴링해서 각자 파싱하면 학교 전체 기준으로 같은 문서를 N번 파싱하게 되는
// 문제가 있었음(team_plan_summary.docx 6절에서 이미 예상했던 비용 문제). doc_id
// (=ERP aprvNo, 문서마다 고유)를 캐시 키로 써서, 이미 파싱한 문서면 Claude API를
// 다시 안 부르고 캐시된 결과를 그대로 돌려준다. KV 네임스페이스 같은 별도 프로비저닝
// 없이 모든 Worker에 기본 제공되는 Cache API(caches.default)를 사용 — 캐시 키를
// 그 자체로 유효한 요청 URL처럼 만들어야 해서, 실제로 호출되지 않는 내부 전용
// 가짜 URL(https://cache.internal/parsed-doc/{doc_id})을 캐시 키로만 사용한다.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_MODEL = "claude-haiku-4-5";
// 2026-09-05 추가: claudeApi.js가 항상 자체 SYSTEM_PROMPT(스키마 명시)를 보내므로
// 평소엔 이 기본값이 안 쓰이지만, 혹시 system 필드 없이 호출되는 경우를 대비한
// 방어적 기본값 — claudeApi.js와 반드시 같은 필드 스키마를 유지할 것.
const DEFAULT_SYSTEM_PROMPT = `당신은 대학 행정 협조문을 분석하는 어시스턴트입니다.
사용자가 보낸 협조문 원문을 분석해서, 아래 7개 필드로만 구성된 JSON 객체 하나를
반환하세요. 코드펜스나 설명 문장 없이 JSON 객체만 반환합니다.

{
  "title": "문서 제목 (string)",
  "sender_dept": "발신 부서명 (string, 원문에서 찾을 수 없으면 빈 문자열)",
  "deadline": "마감기한, YYYY-MM-DD 형식의 문자열. 명시된 마감일이 없으면 null (문자열 아님)",
  "requires_action": "조교/담당자가 실제로 처리해야 할 일이 있으면 true, 단순 통보/참고용이면 false (boolean)",
  "action_type": "requires_action이 true일 때, 해야 할 행동을 다음 중 하나의 짧은 한국어 단어로: 회신, 제출, 확인, 참석, 결재, 신청, 기타. requires_action이 false면 null",
  "action_description": "requires_action이 true일 때, 정확히 무엇을 누구에게/어디로 제출·회신해야 하는지 10~20자 내외로 아주 짧게(명사구로). requires_action이 false면 null",
  "summary": "문서 용건을 한 문장, 25자 내외의 명사구로 압축"
}

summary 작성 예시:
- 나쁜 예: "국민취업지원제도 안내를 위해 2026년 9월부터 12월까지 학과사무실을 방문하는 설명회를 운영합니다."
- 좋은 예: "국민취업지원제도 설명회 방문 협조 요청"
summary는 배경 설명 없이 "무엇에 대한 협조/통보인지"만 명사구로 압축하고, 두 문장
이상 쓰지 마세요.`;
// 캐시 보관 기간. 협조문 내용은 한 번 등록되면 안 바뀌는 게 보통이라 길게 잡아도
// 안전함 — 상태(stGbn) 변경은 별도 로직(handleChangedCoopDoc)이 처리하고, 이 캐시는
// "본문 텍스트 → 파싱 결과" 매핑만 담당한다.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

const CORS_HEADERS = {
  // 확장 백그라운드(service worker)에서 fetch할 때 manifest.json host_permissions에
  // 이 Worker 도메인이 없으면 CORS에 걸릴 수 있어서, 응답 쪽에서도 명시적으로
  // 허용해둔다(이중 안전장치 — host_permissions도 배포 후 채워 넣을 것).
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-proxy-secret",
};

export default {
  async fetch(request, env, ctx) {
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

    const { model, system, text, doc_id: docId } = body || {};
    if (!text || typeof text !== "string") {
      return jsonResponse({ error: "text 필드(문자열)가 필요합니다." }, 400);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: "서버에 ANTHROPIC_API_KEY 시크릿이 설정되지 않았습니다." },
        500
      );
    }

    // doc_id가 왔으면 캐시부터 확인 — 같은 문서를 다른 직원이 먼저 파싱해뒀으면
    // Claude API를 아예 안 부르고 그 결과를 그대로 돌려준다.
    const cache = caches.default;
    const cacheKey = docId ? buildCacheKey(docId) : null;
    if (cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const cachedBody = await cached.json();
        return jsonResponse({ ...cachedBody, _cache: "hit" }, 200);
      }
    }

    try {
      const parsed = await callClaude({
        apiKey: env.ANTHROPIC_API_KEY,
        model: model || DEFAULT_MODEL,
        system: system || DEFAULT_SYSTEM_PROMPT,
        text,
      });

      // 캐시 저장은 응답을 늦추지 않도록 ctx.waitUntil로 백그라운드 처리.
      if (cacheKey) {
        const cacheResponse = new Response(JSON.stringify(parsed), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `max-age=${CACHE_TTL_SECONDS}`,
          },
        });
        ctx.waitUntil(cache.put(cacheKey, cacheResponse));
      }

      return jsonResponse({ ...parsed, _cache: "miss" }, 200);
    } catch (err) {
      console.error("[proxy] Claude 호출/파싱 실패:", err);
      return jsonResponse({ error: String(err?.message || err) }, 502);
    }
  },
};

/**
 * doc_id를 Cache API가 요구하는 Request 키(유효한 URL 형태)로 변환한다.
 * 실제로 이 URL로 네트워크 요청이 나가지는 않음 — 캐시 매칭 전용 키일 뿐.
 * @param {string} docId
 * @returns {Request}
 */
function buildCacheKey(docId) {
  const safeId = encodeURIComponent(String(docId));
  return new Request(`https://cache.internal/parsed-doc/${safeId}`);
}

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
