// src/components/CoopCard.jsx
// 협조문 요약 카드.
// 2026-08-22: 가로로 긴 리스트형 카드 → 세로가 긴(정사각형에 가까운) 카드로
// 변경, 순서도 제목 → 요약 → 발신 순으로 재배치 (CoopPage.jsx가 grid로 배치).
// 2026-08-22(2): 팀원이 만든 kbu-assistant(구 프로토타입, css/style.css .doc-card)
// 디자인으로 교체 — 요약을 카드 최상단에 파란 배너로 올리고, 하단에 마감일 +
// 상태 배지를 두는 레이아웃. 색상값도 그 팔레트(--blue-dark #3D57E8,
// --alt #F5F7FF, --border #E4E7F2 등)를 그대로 가져옴.
// ⚠️ 원본 프로토타입은 상태 배지에 ERP stGbn 값을 "대기/진행/완료/반려/결재취소"
// 한글 그대로 썼지만, 우리 실제 ERP 응답의 stGbn은 검증 안 된 코드값("03" 등)이라
// 그대로 붙이면 의미를 알 수 없는 숫자가 뜬다. 대신 이미 검증된 우리 필드
// (requires_action/is_completed/calendar_registered)로 배지를 대체함.
// 2026-08-22(8): 설정 탭(summarySettings) 반영 — 정책에 따라 AI요약을
// 기본으로 접어두고, 카드에서 직접 "펼치기"로 볼 수 있게 함.
// 2026-08-22(10): 카드 전체가 <button> 하나였는데, 접기/펼치기 클릭 영역이
// 텍스트 하나뿐이라 너무 작아서 자꾸 카드 클릭(상세팝업)으로 잘못 새는 문제가
// 있었음 — 카드를 <div>로 바꾸고, 위쪽 정보 영역(제목 등, 흰 배경)과 아래쪽
// AI요약 영역(파란 배경)을 각각 독립된 <button>으로 분리. 흰 영역 아무데나
// 누르면 상세팝업, 파란 영역(AI요약 전체, 라벨+본문) 아무데나 누르면 접기/
// 펼치기만 토글 — 서로 클릭 영역이 겹치지 않아서 오클릭이 없어짐.
// 2026-08-23(15): "협조문 펼치기 없이 그냥 펼쳐놔줘 특히 신규 탭에서는" 요청 —
// 접기/펼치기 토글 자체를 없애고 AI요약을 항상 펼친 채로 보여줌. summarySettings
// 정책(always/recent/unread)에 따른 getDefaultExpanded 분기는 더 이상 카드에서
// 안 씀(항상 true) — Settings 탭의 해당 옵션은 남아있지만 이 카드엔 더 이상
// 영향을 안 준다.
// 2026-08-23(16): 바로 위 결정을 뒤집는 후속 요청 — "신규탭에서는 펼쳐지게
// 하고 전체에서는 다 닫아버려". 이 판단(신규 vs 전체)은 CoopPage.jsx가 갖고
// 있는 newFilter 상태라 여기선 알 수 없으므로, CoopPage.jsx가 그 값을 그대로
// expanded prop으로 내려주고 이 컴포넌트는 그 prop만 그대로 따랐었음.
// 2026-09-05(8): "신규20이랑 전체랑 합쳐서 전체로 만들어줘" 요청으로 신규/
// 전체 탭 자체가 없어지면서 위 방식의 전제(newFilter)가 사라짐 — 탭 기반
// 강제 규칙을 걷어내고, 원래 설계였던 summarySettings(always/recent/unread)
// 기준 getDefaultExpanded를 다시 살림. CoopPage.jsx는 더 이상 expanded prop을
// 내려주지 않고, 이 컴포넌트가 store의 summarySettings를 직접 읽어서 문서별로
// 펼침 여부를 정한다.
// 2026-08-23(2): Stitch로 뽑아본 카드 시안 중 마음에 든 요소(발신부서 앞
// 아이콘, 수신범위 표시)를 반영한 하이브리드 리디자인. 다만 "AI Summary"
// 라벨을 명시적으로 보여주는 건 계속 유지 — 이게 이 앱의 핵심 차별점(이건
// AI가 요약한 내용이다)이라 라벨 없는 시안은 채택 안 함. 아이콘은 부서별로
// 색을 다르게 주지 않고(사용자 피드백: "색상이 너무 다양하면 정신 사나움")
// 부서명 첫 글자 이니셜 + 단일 컬러로 고정. 아이콘 폰트(Tabler 등) 새 의존성
// 추가 안 하려고 순수 텍스트 이니셜로 구현.

import { mockSummarize } from "../lib/kisApi.js";
import useStore from "../store/useStore.js";

// 2026-09-02: CoopPage.jsx와 동일한 기준(이번 달=달력 기준 1일~말일)으로
// "신규"를 판단하도록 통일. 예전엔 "최근 30일" rolling window + is_new를
// 같이 썼는데, "이번 달에 온 것만 신규"라는 원래 합의와 어긋났었다(예: 9/2에
// 8/5 문서도 신규로 잡힘). 한 번도 안 읽은 문서(is_new)는 기안월과 무관하게
// 항상 신규로 취급 — 결재 경유가 길어 기안일 자체는 지난달이지만 이 앱엔
// 방금 막 처음 들어온 문서가 신규 표시 없이 곧장 열람된 것처럼 보이던 버그
// 수정.
function isRecentDoc(doc) {
  // 2026-09-02(2): CoopPage.jsx와 동일한 이유로 is_new 예외를 created_at
  // (이 앱이 실제로 처음 저장한 시점) 기준으로 교체 — 자세한 이유는
  // CoopPage.jsx의 isRecentDoc 주석 참고.
  const now = new Date();
  if (doc.created_at) {
    const created = new Date(doc.created_at);
    if (created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth()) return true;
  }
  if (!doc.date) return false;
  const target = new Date(`${doc.date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  return target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth();
}

// 2026-08-23(13): 부서명 이니셜 원형 배지(DeptIcon)는 "저기 기 이런식으로
// 있는거 없애줘" 요청으로 제거함(헤더에 텍스트만 남김).

// 2026-08-23(12): Stitch 시안 카드(수신 대상/일자 앞에 작은 아이콘) 반영 —
// 새 아이콘 폰트 라이브러리는 추가하지 않고(프로젝트 방침), 순수 인라인 SVG
// 2개만 최소한으로 둔다. 색은 항상 currentColor 하나만 써서("색이 너무
// 다양하면 정신 사납다"는 기존 피드백 반영) 튀지 않게 한다.
function InboxIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 flex-shrink-0" {...props}>
      <path d="M3 10.5V15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4.5M3 10.5 5 5h10l2 5.5M3 10.5h4.2a1 1 0 0 1 .95.68L8.7 13a1 1 0 0 0 .95.68h.7a1 1 0 0 0 .95-.68l.55-1.82a1 1 0 0 1 .95-.68H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 flex-shrink-0" {...props}>
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M6.5 3v3M13.5 3v3" strokeLinecap="round" />
    </svg>
  );
}

// 2026-08-23(12): "협조문 카드 이 시안처럼 해줘" 요청 — 상단 배지를 카드
// 위에 얹는 대신 발신부서 줄 오른쪽에 나란히 배치(시안 2번 레이아웃). NEW는
// 기존처럼 is_new 기준, 그 외엔 기존 StatusBadge 로직 그대로 재사용.
function HeaderBadge({ doc }) {
  if (isRecentDoc(doc)) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#EEF2FF] text-[#3D57E8] flex-shrink-0">
        NEW
      </span>
    );
  }
  if (doc.requires_action && !doc.is_completed) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FDF3E7] text-[#D9822B] flex-shrink-0">
        Action Required
      </span>
    );
  }
  return null;
}

// 2026-09-07(13): "요 상태 값은 필요 없을듯" 요청 — 마감일 줄 오른쪽의
// StatusBadge(완료/제출 필요/캘린더 등록됨 배지)를 없앰. 이 컴포넌트를 쓰던
// 곳이 여기 하나뿐이라 죽은 코드로 안 남기려고 정의도 같이 삭제. "제출 필요"
// 류 정보는 AI Summary 라벨 줄의 action_type 배지로 여전히 보이지만, "완료"
// 상태 자체를 별도 배지로 보여주는 곳은 이제 카드에 없음(마감 옆 텍스트가
// 사라지지 않으니 필요하면 나중에 다시 넣을 수 있음).

// 2026-09-05(8) 추가: useStore.js 상단 주석(loadSummarySettings 근처)에 적힌
// 원래 스펙 그대로 복원 —
//   "always" : 항상 펼침
//   "recent" : doc.date 기준 최근 N주(recentWeeks) 이내만 펼치고 나머지는 접음
//   "unread" : 한 번이라도 열어본(doc.is_new === false) 문서는 접음
// 날짜/읽음 정보가 없어서 판단 불가능한 경우는 안전하게 "펼침" 쪽으로 둔다.
function getDefaultExpanded(doc, summarySettings) {
  const mode = summarySettings?.mode || "always";
  if (mode === "unread") return doc.is_new !== false;
  if (mode === "recent") {
    if (!doc.date) return true;
    const target = new Date(`${doc.date}T00:00:00`).getTime();
    if (Number.isNaN(target)) return true;
    const weeks = summarySettings.recentWeeks || 2;
    const ms = weeks * 7 * 24 * 60 * 60 * 1000;
    return Date.now() - target <= ms;
  }
  return true;
}

// 2026-09-05(7) 추가: "3문장으로 길게 나오는 건 하이픈 사용 등 해서
// 가독성있게 해줘" 요청 — claudeApi.js의 enforceShortText가 새로 파싱되는
// 문서는 한 문장으로 잘라주지만, 그 로직이 생기기 전(프롬프트 버전 낮음)에
// 이미 저장된 구 요약은 여러 문장이 붙은 산문형 그대로 남아있어 한 문단으로
// 뭉쳐 보이면 가독성이 떨어짐. 표시 시점에 문장 단위(claudeApi.js와 동일한
// 문장 경계 규칙)로 나눠서, 문장이 2개 이상이면 각 줄 앞에 "- "를 붙인
// 목록 형태로 보여줌. 문장이 1개면(정상 케이스) 그대로 문단으로 표시.
function formatSummaryForReadability(text) {
  if (!text) return text;
  const sentences = text
    .split(/(?<=[.!?다요함음])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return text;
  return sentences.map((s) => `- ${s}`).join("\n");
}

export default function CoopCard({ doc, onClick, forceExpanded = false }) {
  // 2026-09-05(8): expanded를 더 이상 부모(CoopPage.jsx)가 내려주지 않음 —
  // 설정 탭에서 고른 summarySettings를 이 카드가 직접 구독해서 문서별로
  // 펼침 여부를 계산한다.
  // 2026-09-07: "협조문 탭에서는 AI요약 전부 다 보이게" 요청 — forceExpanded가
  // true면 summarySettings 정책과 무관하게 무조건 펼친다(지금은 CoopPage.jsx만
  // true로 넘김). 다른 화면에서 이 카드를 다시 쓰게 되면 기본값 false라 원래
  // 정책을 그대로 따른다.
  const summarySettings = useStore((s) => s.summarySettings);
  const expanded = forceExpanded || getDefaultExpanded(doc, summarySettings);
  // 2026-09-05 수정: ai_summary가 비어서 mockSummarize(본문 앞부분을 그냥 잘라낸
  // 발췌, AI 아님)로 대체되는 경우에도 라벨이 계속 "AI Summary"로 고정 표시돼서
  // 실사용 중 "이거 그냥 본문 복붙 아니냐"는 혼란이 있었음 — isRealAiSummary로
  // 실제 출처를 구분해서 라벨/스타일을 다르게 보여준다.
  const isRealAiSummary = Boolean(doc.ai_summary);
  const summaryText = doc.ai_summary || mockSummarize(doc);

  return (
    <div
      className="w-full bg-white border border-[#E4E7F2] rounded-[14px] overflow-hidden
        hover:shadow-[0_8px_24px_rgba(26,27,46,0.08)] hover:-translate-y-px transition relative flex flex-col"
    >
      {/* 2026-08-23(12): "협조문 카드 시안 2번처럼 해줘" 요청 — 절대 위치로
          카드 모서리에 걸쳐 있던 NEW 배지를 발신부서 줄과 같은 행에 나란히
          배치(HeaderBadge)하도록 바꿈. 정보(부서/제목/수신/마감) → AI요약
          순서는 기존 결정(2026-08-22(3)) 그대로 유지. */}
      <button type="button" onClick={onClick} className="w-full text-left px-3.5 pt-2 pb-2.5 hover:bg-brand-alt/60 transition">
        {/* 2026-08-22(11): "접었는데도 카드 크기가 들쭉날쭉하다" 리포트 대응 —
            제목(title)은 원래 요청대로 안 잘리게 그대로 두지만, 발신부서/
            기안자 줄이랑 수신부서/날짜 줄은 부서명 길이에 따라(예: "소프트웨어
            융합과"처럼 긴 이름) 줄바꿈되면서 카드마다 이 두 줄의 높이가 달라져
            버렸음(제목이 1줄인 카드끼리도 서로 높이가 다르게 보인 원인). 이
            두 줄만 truncate(한 줄 고정 + 말줄임)로 막아서 카드 높이가 오직
            "제목 몇 줄인지 + 펼침/접힘 상태"에만 좌우되게 함. */}
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* 2026-08-23(13): "기 이런 초성 아이콘 없애줘" 요청으로 DeptIcon
                (부서명 이니셜 원형 배지) 제거 — 발신부서/기안자 텍스트만 남김. */}
            <div className="text-[11px] text-[#6B7280] font-semibold truncate">
              {doc.sender_dept}
              {doc.drafter && ` · ${doc.drafter}`}
            </div>
          </div>
          <HeaderBadge doc={doc} />
        </div>
        {/* 2026-08-22(13): (예전 메모) 2열 그리드였을 때는 카드마다 제목 줄수가
            달라 그 아래 AI요약 시작점이 들쭉날쭉해 보여서 min-h로 2줄 높이를
            항상 미리 확보해뒀었다.
            2026-09-07(11): "카드가 세로로 너무 길다" 요청 — 지금은 1열
            리스트라 카드끼리 나란히 줄맞출 일이 없어졌으니, 그 min-h를 빼서
            제목이 1줄이면 카드도 그만큼 짧아지게 함(제목을 자르지 않는 원칙은
            그대로 유지).
            2026-09-07(12): "상단 여백 없애줘" 요청 — 헤더 줄(부서·기안자/NEW)과
            제목 사이 간격을 5px에서 2px로 더 줄임. */}
        <p className="text-[13.5px] font-bold text-[#1A1B2E] mt-0.5 leading-[1.4]">
          {doc.title || "(제목 없음)"}
        </p>
        {/* 2026-08-23(12): 수신/일자 줄에 작은 아이콘 추가(시안 반영) — 단일
            색(slate-400)만 써서 튀지 않게. */}
        {(doc.recv_dept_name || doc.date) && (
          <p className="flex items-center gap-1 text-[10.5px] text-[#9BA0B4] mt-1 truncate">
            {doc.recv_dept_name && (
              <span className="flex items-center gap-1 min-w-0 truncate">
                <InboxIcon />
                수신: {doc.recv_dept_name}
              </span>
            )}
            {doc.recv_dept_name && doc.date && <span>·</span>}
            {doc.date && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <CalendarIcon />
                {doc.date}
              </span>
            )}
          </p>
        )}
        {/* 2026-09-07(13): "요 상태 값은 필요 없을듯" 요청 — 마감일 줄 오른쪽에
            있던 StatusBadge(완료/제출 필요/캘린더 등록됨)를 없앰. 같은 정보가
            바로 아래 AI Summary 라벨 줄의 action_type 배지("제출 필요" 등)로도
            이미 나오고 있어서 중복이었음. */}
        <p className="text-[11.5px] text-[#6B7280] mt-2">
          {doc.deadline ? `마감 ${doc.deadline}` : "기한 없음"}
        </p>
      </button>
      {/* 2026-08-22(9): "접으면 카드는 그대로고 빈 여백만 남는다" 버그 수정 —
          원인은 CoopPage.jsx 그리드의 기본 align-items: stretch + 카드가
          h-full 버튼이었던 것. h-full 제거 + CoopPage.jsx의 items-start로
          각 카드가 자기 내용(=펼침/접힘 상태) 높이만큼만 차지하게 함.
          "AI요약" 라벨 + 구분선 + 본문. 본문 영역은 h-[96px](고정 높이,
          min-h 아님!) + line-clamp 4줄로 펼쳐진 카드끼리는 요약 길이와
          무관하게 항상 같은 크기가 되게 함.
          2026-08-23(12): 카드 가장자리까지 꽉 채우던 파란 배너를 살짝 안쪽
          여백(mx-2.5 mb-2.5)을 준 둥근 박스로 바꿔서 "떠 있는" 느낌을 줌
          (시안 반영). */}
      {/* 2026-08-23(16): 더 이상 카드 자체가 접기/펼치기를 결정하지 않음 —
          부모(CoopPage.jsx)가 내려준 expanded prop(신규 탭이면 true, 전체
          탭이면 false)을 그대로 따르는 정적 <div>. 라벨 바는 접혀있을 때도
          "AI Summary가 있다"는 걸 알 수 있게 항상 보여주고, 본문만 prop에
          따라 렌더링 여부가 갈림. */}
      <div className="mt-auto w-full text-left">
        <div className="mx-2.5 mb-2.5 rounded-[10px] bg-[#F5F7FF] border border-[#E4E7F2] overflow-hidden">
        <div className={`flex items-center justify-between px-3 pt-2 pb-1.5 ${expanded ? "border-b border-[#E4E7F2]" : ""}`}>
          <p
            className={`text-[10px] font-bold tracking-wide flex items-center gap-1 ${
              isRealAiSummary ? "text-[#3D57E8]" : "text-[#8B8FA3]"
            }`}
          >
            {isRealAiSummary ? (
              <>
                <span aria-hidden>✨</span>AI Summary
              </>
            ) : (
              <>
                <span aria-hidden>📄</span>본문 발췌 (AI 요약 아님)
              </>
            )}
          </p>
          {/* 2026-09-05(2) 추가: 회신/제출/확인 등 처리유형을 요약 라벨과 같은
              줄에 배지로 바로 보여줌 — "요약 읽기 전에 뭘 해야 하는지부터
              알고 싶다"는 실사용 피드백 반영. */}
          {isRealAiSummary && doc.action_type && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#3D57E8] text-white flex-shrink-0">
              {doc.action_type} 필요
            </span>
          )}
        </div>
        {/* 2026-09-05(3) 수정: "조치 내용이 길면 잘린다"는 리포트 — 예전엔
            카드 그리드 높이를 딱 맞추려고 요약 영역을 고정 높이(height:40px/96px)
            + overflow:hidden으로 강제했고, 기한/조치 줄도 truncate(한 줄+말줄임)
            였다. 그러다 보니 조치 설명이 조금만 길어도 중간에 잘려서 정작
            중요한 정보(뭘 해야 하는지)가 안 보이는 문제가 있었음. 카드마다
            높이가 살짝 달라지는 걸 감수하고, 고정 높이/overflow-hidden/truncate를
            전부 없애서 내용이 항상 끝까지 다 보이게 함. */}
        {expanded && (
          <div className="px-3 py-2">
            {/* 2026-09-05(6): "요약이 밑으로, 기한/조치가 위로" 요청 — 카드를
                열자마자 "언제까지 뭘 해야 하는지"부터 보이게 순서를 뒤집음
                (preview_order_swap.html에서 미리 봤던 순서). 구분선은 이제
                메타 블록 밑(border-bottom)에 붙고, 요약 문단 쪽엔 위쪽 여백만
                살짝 줘서 메타 블록과 시각적으로 분리. */}
            {isRealAiSummary && (doc.deadline || doc.action_description) && (
              <div className="pb-1.5 mb-1.5 border-b border-[#E4E7F2] flex flex-col gap-1">
                {doc.deadline && (
                  <p className="text-[11px] text-[#4B5563] leading-[1.4]">
                    <span className="font-semibold text-[#3D57E8]">기한</span> {doc.deadline}
                  </p>
                )}
                {doc.action_description && (
                  <p className="text-[11px] text-[#4B5563] leading-[1.4]">
                    <span className="font-semibold text-[#3D57E8]">조치</span> {doc.action_description}
                  </p>
                )}
              </div>
            )}
            {/* 2026-09-07(11): "카드가 세로로 너무 길다" 요청 — 2026-09-05(3)에서
                "조치가 잘린다"는 이유로 없앴던 줄 수 제한을, 이번엔 조치/기한이
                아니라 AI 요약 문단에만 다시 걸었다(line-clamp-3). 조치/기한은
                여전히 절대 안 잘림(위 블록). 요약이 길어서 잘리는 부분은 카드
                위쪽(헤더 영역)을 눌러 상세 팝업에서 전체를 볼 수 있음.
                2026-09-07(12): "원문 보기 없애줘" 요청 — 2026-09-07(5)에서
                추가했던 "원문 보기 →" 링크(요약 박스 안, onClick=openDetail)를
                다시 뺐다. 상세 팝업 자체는 카드 헤더 클릭으로 여전히 열림. */}
            <div
              className={`text-[12px] leading-[1.5] whitespace-pre-line line-clamp-3 ${
                isRealAiSummary ? "text-[#3D57E8]" : "text-[#6B7280]"
              }`}
            >
              {formatSummaryForReadability(summaryText) || "요약 불가"}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
