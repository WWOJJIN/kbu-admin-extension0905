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
// 2026-09-05(5): "요약이 짤려서 나온다" 리포트 — 목표(40~60자)보다 모델이
// 조금 길게(70~90자) 써서 붙는 경우가 실제로 잦았는데, 70자 하드컷이 그
// 경우 문장 끝(다/요 등)에 닿기도 전에 단어 중간에서 잘라버려("...안내입니…"
// 처럼) 부자연스러웠음. 문장 끝을 못 찾은 채 하드컷하는 것 자체를 지양하고,
// 컷 한도를 120자로 늘려 "조금 긴 정상 문장"은 안 잘리게 함(진짜 폭주하는
// 경우에 대한 안전장치 성격은 유지).
const SUMMARY_MAX_CHARS = 120;
const ACTION_DESC_MAX_CHARS = 60;
function enforceShortText(text, maxChars) {
  if (!text) return "";
  const firstSentence = text.split(/(?<=[.!?다요함음])\s+/)[0] || text;
  const trimmed = firstSentence.trim();
  if (trimmed.length <= maxChars) return trimmed;
  // 문장 중간을 단어 경계 없이 자르면 "안내입니…"처럼 부자연스러우니,
  // 컷 지점 근처의 마지막 공백에서 끊어서 최소한 어절 단위로는 잘리게 함.
  const hardCut = trimmed.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(" ");
  const safeCut = lastSpace > maxChars * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${safeCut}…`;
}

// 2026-09-05(4) 추가: 프롬프트/스키마를 바꿀 때마다 값을 올린다. 이미 저장된
// 문서의 ai_summary_prompt_version이 이 값보다 낮으면 "재요약이 필요한 문서"로
// 다시 잡힌다(useStore.js getMissingAiSummaryCandidates 참고) — ai_summary가
// 이미 있어도(예전 버전으로 채워진 것) 새 프롬프트로 다시 돌릴 수 있게 하려는
// 목적. 버전 이력: 1=스키마 필드명 없음(항상 빈 요약), 2=필드명은 있지만 길이
// 제약 없음(산문형, 너무 김), 3=25자 명사구 강제(너무 짧음), 4=40~60자 한 문장,
// 5=하드컷 한도 120자로 완화 + 어절 경계 컷(문장 중간 부자연스러운 절단 방지).
export const PROMPT_VERSION = 5;

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

// ---------------------------------------------------------------------------
// 협조문/내부기안 초안 작성 (2026-09-08 신규)
// ---------------------------------------------------------------------------
// ChatPage.jsx의 챗봇에서 "OOO 관련해서 내부기안 작성하려고해 초안 작성해줘"처럼
// 요청하면 이 함수가 호출된다. parseCoopDoc과 반대 방향(원문→요약이 아니라
// 사용자 요청→원문 초안)이지만, 프록시 호출/재시도 방식은 그대로 재사용한다.
//
// ⚠️ 이 함수는 "초안"만 만든다 — content.js가 이 결과를 ERP 화면에 채워주더라도,
// 실제 ERP 저장(임시저장/상신하기)은 사람이 반드시 마지막에 직접 눌러야 한다
// (지침의 "조회 전용" 철학을 여기서도 그대로 따름). 그래서 프롬프트에도
// "확정 정보가 없으면 지어내지 말라"는 지시를 명시해뒀다.
//
// 2026-09-08(2) 수정: 우진이 실제 결재 완료된 경복대 내부기안 4건(PDF/DOCX)을
// 주고 "이걸로 학습시킬 수 있냐"고 물어서, 진짜 파인튜닝 대신 프롬프트에 실제
// 문서 스타일을 예시로 박아넣는 few-shot 방식으로 반영했다. 그 문서들을 보고
// 알게 된 것 — 처음 짰던 "<p> 문단 2~4개"짜리 산문형 프롬프트는 실제 기안문
// 스타일과 전혀 달랐음:
//  - 목적/대상/진행절차는 완결된 문장이 아니라 "- "로 시작하고 명사형으로
//    끝나는(~강화, ~도모, ~창출, ~마련하고자 함) 개조식 항목이었음.
//  - 사업개요는 산문이 아니라 "상위사업 > 중간분류 > 세부사업"처럼 ">"로
//    계층을 구분한 한 줄짜리 분류 문자열이었음.
//  - 대상 항목은 "운영대상 : ..." / "수행주체 : ..." 두 줄 형식이 고정 패턴.
// 그래서 스키마 자체를 main_content 하나에서 purposeHtml/targetHtml/
// procedureHtml 세 개로 쪼갰다(ERP의 가.목적/라.대상/마.진행절차 세 칸에 각각
// 대응 — content.js DOC_TYPE_CONFIG.내부기안.contentRows 참고). 예산(라.예산)
// 칸은 일부러 스키마에서 뺐다 — 그 칸은 리치텍스트 팝업이 아니라 드롭다운+금액
// 입력이라 이 자동 채움 방식(SmartEditor2 iframe에 HTML 주입) 자체가 안 통해서,
// 초안에 넣어봤자 채울 방법이 없다.
function buildDraftSystemPrompt(docType) {
  return `당신은 대학 행정직원이 KBU 통합정보시스템(ERP)에 "${docType}"을 작성하는 걸
돕는 초안 작성 보조입니다. 사용자의 짧은 요청을 바탕으로, 아래 필드로만 구성된
JSON 객체 하나를 반환하세요. 코드펜스나 설명 문장 없이 JSON 객체만 반환합니다.

{
  "title": "문서 제목 (string, 20~30자 내외의 명사구로 끝맺음. 예: 'OOO 프로그램 운영 계획(안) 보고')",
  "overview": "사업개요/머리글 칸에 들어갈 내용. 완전한 문장이 아니라 '상위사업 > 중간분류 >
    세부사업'처럼 '>'로 계층을 구분한 한 줄짜리 분류 문자열로 쓰세요.",
  "purposeHtml": "가.목적 칸에 들어갈 HTML. 완결된 문장이 아니라 '- '로 시작하고
    명사형으로 끝나는 개조식 항목 2~4개를 각각 <p> 태그로 감싸서 반환하세요.",
  "targetHtml": "대상 칸에 들어갈 HTML. '<p>- 운영대상 : ...</p><p>- 수행주체 : ...</p>'
    형식(둘 중 사용자가 언급 안 한 쪽은 '(추후 확정)').",
  "procedureHtml": "진행절차 칸에 들어갈 HTML. 실제 진행 순서를 '- '로 시작하는
    개조식 항목 3~5개로, 각각 <p> 태그로 감싸서 시간 순서대로 나열하세요."
}

문체·형식 규칙 (실제 경복대 기안문 예시 기준):
- purposeHtml/targetHtml/procedureHtml의 각 항목은 "~합니다/~입니다"로 끝나는
  서술형 문장이 아니라, "~강화", "~구축", "~창출", "~운영(연 1회)", "~마련하고자
  함"처럼 명사형이나 개조식으로 짧게 끝맺으세요.
- 사용자가 준 정보 안에서만 구체적으로 쓰고, 날짜·금액·장소·담당자명·기관명처럼
  사용자가 말하지 않은 확정 정보는 절대 지어내지 마세요. 필요한데 안 준 정보는
  "(추후 확정)"으로 남겨서, 사람이 검토 후 채워 넣어야 할 자리라는 걸 알 수
  있게 하세요.
- title은 자연스러운 문장이 아니라 문서 제목다운 명사구로 끝맺으세요.
- 예산 관련 내용은 이 초안에 포함하지 마세요 — ERP의 예산 칸은 드롭다운+금액
  입력 방식이라 이 초안(HTML 삽입 방식)으로는 채울 수 없는 칸이라, 사람이
  직접 입력해야 합니다.

형식 참고용 예시 (실제 경복대 내부기안 스타일을 일반화한 것 — 이 예시의 소재를
그대로 베끼지 말고 형식/문체만 참고하세요):
- overview 예: "AI 기반 실전형 학습경험 및 미래역량 고도화 > AI/DX 실천형 교육혁신 > AI 해커톤 대회"
- purposeHtml 예: "<p>- AI 기반 단기 집중 프로젝트 수행을 통해 학생 문제해결 역량 강화</p><p>- 교수·학생·직원 간 협업을 통한 실질적 교육성과 창출 도모</p><p>- 우수 결과물의 교내 적용 및 상용화 연계 추진</p>"
- targetHtml 예: "<p>- 운영대상 : 재학생 및 교직원</p><p>- 수행주체 : (추후 확정)</p>"
- procedureHtml 예: "<p>- 프로그램 운영 계획 수립 및 참가자 모집·선발</p><p>- 참가팀별 과제 수행 및 중간점검</p><p>- 최종결과보고서 심사 및 성과발표회·시상</p>"`;
}

/**
 * @typedef {Object} DraftedDoc
 * @property {string} title
 * @property {string} overview  사업개요/머리글에 들어갈 "A > B > C" 분류 문자열
 * @property {string} purposeHtml  가.목적 칸 HTML (<p>- ...</p> 개조식)
 * @property {string} targetHtml  대상 칸 HTML
 * @property {string} procedureHtml  진행절차 칸 HTML
 */

/**
 * 사용자의 짧은 요청(예: "산학협력 관련 현장실습 협조 요청 내부기안 써줘")을
 * 프록시 경유 Claude API로 보내 문서 초안을 만든다. 실패 시 1회 재시도.
 * @param {string} userQuery
 * @param {"내부기안"|"협조문"} docType
 * @returns {Promise<DraftedDoc>}
 */
export async function draftDocument(userQuery, docType) {
  if (!PROXY_URL) {
    throw new Error(
      "[claudeApi] 프록시 서버 URL이 아직 설정되지 않음 (proxy/ 배포 후 PROXY_URL을 채울 것)"
    );
  }
  return callDraftProxyWithRetry(userQuery, docType, 1);
}

async function callDraftProxyWithRetry(userQuery, docType, retries) {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PROXY_SECRET_HEADER]: PROXY_SECRET,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        system: buildDraftSystemPrompt(docType),
        text: userQuery,
        // 초안 생성은 사용자마다 요청이 다 달라서 파싱 캐시와 달리 doc_id로
        // 캐시할 대상이 없음 — parseCoopDoc과 같은 프록시 엔드포인트를 쓰되
        // doc_id는 항상 null로 보낸다(프록시가 doc_id 없으면 캐시 없이 그냥
        // 매번 호출하는 기존 동작을 그대로 이용).
        doc_id: null,
      }),
    });
    if (!res.ok) throw new Error(`프록시 요청 실패: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return normalizeDraft(data);
  } catch (err) {
    if (retries > 0) {
      return callDraftProxyWithRetry(userQuery, docType, retries - 1);
    }
    throw err;
  }
}

function normalizeDraft(data) {
  return {
    title: data?.title ?? "",
    overview: data?.overview ?? "",
    purposeHtml: data?.purposeHtml ?? "",
    targetHtml: data?.targetHtml ?? "",
    procedureHtml: data?.procedureHtml ?? "",
  };
}
