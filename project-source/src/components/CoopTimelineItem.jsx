// src/components/CoopTimelineItem.jsx
// 협조문 타임라인 행 — CoopPage.jsx가 그리드 카드(CoopCard.jsx) 대신 이 컴포넌트를
// 세로로 나열해서 "접수일 순서" 흐름 중심으로 보여주는 뷰. 2026-09-05 추가
// ("타임라인형으로 가보자" 요청, 미리보기 preview_layout_styles.html의 ④안 채택).
//
// 배지/AI요약/상태 판단 로직(isRecentDoc/HeaderBadge/StatusBadge)은 CoopCard.jsx와
// 완전히 동일하게 맞춤 — 같은 문서가 어느 화면에서 보이든 같은 기준으로 같은
// 배지가 뜨게 하기 위함. CoopCard.jsx와 마찬가지로 이 파일 안에 독립적으로 들고
// 있음(CoopPage.jsx/CoopCard.jsx가 isRecentDoc을 각자 들고 있는 기존 관례를
// 그대로 따름 — 자세한 이유는 CoopCard.jsx 상단 주석 참고).

import { mockSummarize } from "../lib/kisApi.js";

function isRecentDoc(doc) {
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

function InboxIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3 h-3 flex-shrink-0" {...props}>
      <path d="M3 10.5V15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4.5M3 10.5 5 5h10l2 5.5M3 10.5h4.2a1 1 0 0 1 .95.68L8.7 13a1 1 0 0 0 .95.68h.7a1 1 0 0 0 .95-.68l.55-1.82a1 1 0 0 1 .95-.68H17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 2026-09-05: HeaderBadge는 CoopCard.jsx와 동일 — NEW는 isRecentDoc 기준, 그 외엔
// requires_action && !is_completed일 때만 "Action Required"(영문, CoopCard.jsx의
// 기존 표기를 그대로 따름 — 하단 StatusBadge의 한글 action_type 배지와는 별개).
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

function StatusBadge({ doc }) {
  if (doc.requires_action && !doc.is_completed) {
    const label = doc.action_type ? `${doc.action_type} 필요` : "처리 필요";
    return (
      <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-[6px] bg-[#FDF3E7] text-[#D9822B]">
        {label}
      </span>
    );
  }
  if (doc.is_completed) {
    return (
      <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-[6px] bg-[#EAF7F1] text-[#1E9E6E]">
        완료
      </span>
    );
  }
  if (doc.calendar_registered) {
    return (
      <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-[6px] bg-[#F5F7FF] text-[#3D57E8]">
        캘린더 등록됨
      </span>
    );
  }
  return null;
}

// 타임라인 점 테두리 색 — 완료(초록) > 처리 필요(주황) > 그 외(회색), 우선순위는
// StatusBadge와 동일하게 맞춤.
function dotBorderClass(doc) {
  if (doc.is_completed) return "border-[#1E9E6E]";
  if (doc.requires_action) return "border-[#D9822B]";
  return "border-[#C7CBDA]";
}

/**
 * @param {Object} props
 * @param {import("../lib/db.js").CoopDoc} props.doc
 * @param {() => void} props.onClick
 * @param {boolean} [props.expanded]  AI요약 본문을 펼쳐서 보여줄지 — CoopPage.jsx가
 *   newFilter(신규/전체 탭)에 따라 내려줌. CoopCard.jsx와 동일한 계약.
 * @param {boolean} [props.isLast]  마지막 항목이면 아래로 이어지는 세로선을 안 그림.
 */
export default function CoopTimelineItem({ doc, onClick, expanded = true, isLast = false }) {
  const isRealAiSummary = Boolean(doc.ai_summary);
  const summaryText = doc.ai_summary || mockSummarize(doc);

  return (
    <div className="relative pl-7 pb-5">
      {/* 세로 연결선 — 마지막 항목은 안 그림(선이 허공에 붕 떠서 끝나는 것 방지) */}
      {!isLast && <span className="absolute left-[9px] top-5 bottom-0 w-px bg-[#E4E7F2]" aria-hidden="true" />}
      {/* 날짜/상태 점 — CoopCard.jsx HeaderBadge와 같은 우선순위(NEW>처리필요>완료) 기준 색 */}
      <span
        className={`absolute left-0 top-[18px] w-3 h-3 rounded-full bg-white border-[3px] ${dotBorderClass(doc)}`}
        aria-hidden="true"
      />
      <div className="text-[11px] font-bold text-[#8B8FA3] mb-1.5 flex items-center gap-1 flex-wrap">
        <span>{doc.date || "날짜 미상"}</span>
        {doc.sender_dept && (
          <span className="font-medium text-[#9BA0B4]">
            · {doc.sender_dept}
            {doc.drafter && ` · ${doc.drafter}`}
          </span>
        )}
      </div>
      <div className="bg-white border border-[#E4E7F2] rounded-[14px] overflow-hidden hover:shadow-[0_8px_24px_rgba(26,27,46,0.08)] transition">
        <button type="button" onClick={onClick} className="w-full text-left px-3.5 pt-3 pb-3 hover:bg-brand-alt/60 transition">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <p className="text-[13.5px] font-bold text-[#1A1B2E] leading-[1.4]">{doc.title || "(제목 없음)"}</p>
            <HeaderBadge doc={doc} />
          </div>
          {doc.recv_dept_name && (
            <p className="flex items-center gap-1 text-[10.5px] text-[#9BA0B4] mt-1.5 truncate">
              <InboxIcon />
              수신: {doc.recv_dept_name}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 mt-2.5">
            <span className="text-[11.5px] text-[#6B7280]">
              {doc.deadline ? `마감 ${doc.deadline}` : "기한 없음"}
            </span>
            <StatusBadge doc={doc} />
          </div>
        </button>
        <div className="mx-2.5 mb-2.5 rounded-[10px] bg-[#F5F7FF] border border-[#E4E7F2] overflow-hidden">
          <div className={`flex items-center justify-between px-3 pt-2 pb-1.5 ${expanded ? "border-b border-[#E4E7F2]" : ""}`}>
            <p
              className={`text-[10px] font-bold tracking-wide flex items-center gap-1 ${
                isRealAiSummary ? "text-[#3D57E8]" : "text-[#8B8FA3]"
              }`}
            >
              {isRealAiSummary ? (
                <>
                  <span aria-hidden="true">✨</span>AI Summary
                </>
              ) : (
                <>
                  <span aria-hidden="true">📄</span>본문 발췌 (AI 요약 아님)
                </>
              )}
            </p>
            {isRealAiSummary && doc.action_type && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#3D57E8] text-white flex-shrink-0">
                {doc.action_type} 필요
              </span>
            )}
          </div>
          {expanded && (
            <div className="px-3 py-2.5">
              <div
                className={`text-[12px] leading-[1.5] whitespace-pre-line ${
                  isRealAiSummary ? "text-[#3D57E8]" : "text-[#6B7280]"
                }`}
              >
                {summaryText || "요약 불가"}
              </div>
              {isRealAiSummary && (doc.deadline || doc.action_description) && (
                <div className="mt-1.5 pt-1.5 border-t border-[#E4E7F2] flex flex-col gap-1">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
