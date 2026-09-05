// src/lib/claudeApi.js
// Claude API 파싱 함수. 반드시 프록시 서버를 경유해서 호출한다.
// (코딩 규칙: api.anthropic.com 직접 호출 금지, API 키를 확장 코드/manifest에 절대
// 포함하지 않음 — Claude API 호출은 이 파일에서만 수행)
//
// 2026-09-05: 프록시 서버(Cloudflare Worker, proxy/) 배포 완료 (W님 작업).
// PROXY_SECRET은 proxy/.dev.vars 및 Cloudflare 대시보드 시크릿과 반드시 같은 값이어야 함.

const PROXY_URL = "https://kbu-admin-proxy.20250147.workers.dev";
const PROXY_SECRET_HEADER = "x-proxy-secret";
const PROXY_SECRET = "b7f00dd4f162baf019d3cae3969d4ee7e85f10f05c13f4a607545d671857e9bc";

// 2026-09-05(4) 수정: 실사용 피드백 — 예전 프롬프트(산문형)는 너무 길고,
// 그 다음 시도(25자 명사구 강제)는 너무 짧아서 자연스러운 문장이 안 됨.
// "한 문장, 40~60자" 정도의 중간 지점으로 재조정. 예시도 그 길이에 맞게 다시 씀.
const SYSTEM_PROMPT = `당신은 대학 행정 협조문을 분석하는 어시스턴트입니다.
사용자가 보낸 협조문 원문을 분석해서, 아래 7개 필드로만 구성된 JSON 객체 하나를
반환하세요. 코드펜스나 설명 문장 없이 JSON 객체만 반환합니다.

{
  "title": "문서 제목 (string)",
  "sender_dept": "발신 부서명 (string, 원문에서 찾을 수 없으면 빈 문자열)",
  "deadline": "마감기한, YYYY-MM-DD 형식의 문자열. 명시된 마감일이 없으면 null (문자열 아님)",
  "requires_action": "조교/담당자가 실제로 처리해야 할 일이 있으면 true, 단순 통보/참고용이면 false (boolean)",
  "action_type": "requires_action이 true일 때, 해야 할 행동을 다음 중 하나의 짧은 한국어 단어로: 회신, 제출, 확인, 참석, 결재, 신청, 기타. requires_action이 false면 null",
  "action_description": "requires_action이 true일 때, 정확히 무엇을 누구에게/어디로 제출·회신해야 하는지 15~25자 정도로 짧게. requires_action이 false면 null",
  "summary": "문서 용건을 자연스러운 한 문장, 40~60자 정도로 요약. 아래 예시의 '좋은 예' 길이/톤을 반드시 따를 것"
}

summary 작성 예시 (반드시 이 정도 길이/톤을 따를 것):
- 나쁜 예(너무 김): "국민취업지원제도 안내를 위해 2026년 9월부터 12월까지 학과사무실을 방문하는 설명회를 운영합니다. 학과는 위탁기관 담당자의 방문에 협조하고 홍보물을 게시해야 하며, 학과 맞춤형 설명회 일정을 협의해야 합니다."
- 나쁜 예(너무 짧음, 문장이 아니라 명사구만): "국민취업지원제도 설명회 방문 협조 요청"
- 좋은 예(딱 적당함): "국민취업지원제도 설명회를 위해 학과사무실 방문 협조와 일정 협의를 요청하는 안내입니다."
- 나쁜 예(너무 김): "2026년 9월 7일부터 11월 2일까지 광릉테크노밸리 산업단지에서 진행되는 AI 직무교육을 위해 소프트웨어융합학과 공용장비 노트북 10대를 대여합니다. 교육 담당자가 장비를 관리하고 교육 종료 후 상태를 확인하여 일괄 반납해야 합니다."
- 나쁜 예(너무 짧음): "AI 직무교육용 노트북 10대 대여 협조"
- 좋은 예(딱 적당함): "AI 직무교육에 필요한 공용 노트북 10대를 대여하니 담당자가 관리해달라는 요청입니다."

summary는 배경 설명·세부 절차를 늘어놓지 말고 핵심 용건 하나만 자연스러운 문장으로
쓰되, 명사구로 뚝 끊지 말고 "~요청입니다/~안내입니다"처럼 문장으로 끝맺으세요.
두 문장 이상 쓰지 마세요.`;

/**
 * @typedef {Object} ParsedCoopDoc
 * @property {string} title
 * @property {string} sender_dept
 * @property {string|null} deadline  YYYY-MM-DD or null
 * @property {boolean} requires_action
 * @property {string|null} action_type  "회신"|"제출"|"확인"|"참석"|"결재"|"신청"|"기타"|null
 * @property {string|null} action_description
 * @property {string} summary  짧은 핵심 요약(1~2문장)
 */

/**
 * 협조문 원문을 프록시 경유 Claude API로 파싱한다.
 * 실패 시 1회 재시도, 그래도 실패하면 에러를 던진다 (에러 토스트 표시는 호출부 책임).
 * @param {string} rawText
 * @param {string} [aprvNo]  협조문 고유 결재번호. 프록시 쪽에서 여러 사용자가
 *   같은 문서를 각자 파싱하지 않도록 캐시 키로 쓰라고 같이 보낸다 — 학교
 *   전체에서 같은 협조문을 한 번만 Claude API로 파싱하게 하려는 목적.
 *   (2026-09-05 추가: team_plan_summary.docx 6절 "같은 문서 중복 파싱 비용"
 *   대응 — 프록시 쪽 캐싱 구현은 프록시 담당자(W)가 맡음)
 * @returns {Promise<ParsedCoopDoc>}
 */
export async function parseCoopDoc(rawText, aprvNo) {
  if (!PROXY_URL) {
    throw new Error(
      "[claudeApi] 프록시 서버 URL이 아직 설정되지 않음 (proxy/ 배포 후 PROXY_URL을 채울 것)"
    );
  }
  return callProxyWithRetry(rawText, aprvNo, 1);
}

async function callProxyWithRetry(rawText, aprvNo, retries) {
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
        // 캐시 키용 문서 고유 ID. 프록시가 이 값으로 "이미 파싱한 문서인지"
        // 먼저 확인하고, 있으면 Claude API 호출 없이 캐시된 결과를 돌려주는
        // 방식을 기대함 — 값이 없어도(aprvNo 미전달) 요청 자체는 그대로 동작.
        doc_id: aprvNo ?? null,
      }),
    });
    if (!res.ok) throw new Error(`프록시 요청 실패: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return normalizeParsedDoc(data);
  } catch (err) {
    if (retries > 0) {
      return callProxyWithRetry(rawText, aprvNo, retries - 1);
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
// 2026-09-05(3) 추가: 프롬프트로 길이를 아무리 지시해도 모델이 가끔 길게
// 쓸 수 있다는 걸 감안해서, 화면에서 다시 "구구절절"해지는 걸 막는 최후의
// 안전장치. 첫 문장만 남기고, 그래도 길면 글자수로 강제 컷.
// 2026-09-05(4): 목표 길이를 40~60자로 재조정하면서 강제컷 한도도 같이 늘림
// (40자는 너무 타이트해서 문장이 아니라 명사구로만 끝나버리는 원인이었음).
const SUMMARY_MAX_CHARS = 70;
const ACTION_DESC_MAX_CHARS = 35;
function enforceShortText(text, maxChars) {
  if (!text) return "";
  const firstSentence = text.split(/(?<=[.!?다요함음])\s+/)[0] || text;
  const trimmed = firstSentence.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

// 2026-09-05(4) 추가: 프롬프트/스키마를 바꿀 때마다 값을 올린다. 이미 저장된
// 문서의 ai_summary_prompt_version이 이 값보다 낮으면 "재요약이 필요한 문서"로
// 다시 잡힌다(useStore.js getMissingAiSummaryCandidates 참고) — ai_summary가
// 이미 있어도(예전 버전으로 채워진 것) 새 프롬프트로 다시 돌릴 수 있게 하려는
// 목적. 버전 이력: 1=스키마 필드명 없음(항상 빈 요약), 2=필드명은 있지만 길이
// 제약 없음(산문형, 너무 김), 3=25자 명사구 강제(너무 짧음), 4=40~60자 한 문장.
export const PROMPT_VERSION = 4;

function normalizeParsedDoc(data) {
  return {
    title: data?.title ?? "",
    sender_dept: data?.sender_dept ?? "",
    deadline: data?.deadline ?? null,
    requires_action: Boolean(data?.requires_action),
    action_type: data?.action_type ?? null,
    action_description: data?.action_description ? enforceShortText(data.action_description, ACTION_DESC_MAX_CHARS) : null,
    summary: enforceShortText(data?.summary ?? "", SUMMARY_MAX_CHARS),
  };
}
