// src/components/TaskPanel.jsx
// "처리해야 할 일" — 협조문에서 requires_action=true로 자동 판별된 문서만
// 보여주는 패널. 사용자가 직접 추가하는 자유 할 일은 TodoListPanel.jsx로
// 분리했다(2026-09-02, 팀에서 공유한 화면 구성 반영 — 원래는 이 컴포넌트가
// 자동 판별 항목과 자유 할 일을 한 리스트에 섞어서 보여줬는데, "자동으로
// 뜨는 것"과 "내가 직접 추가하는 것"은 성격이 달라서 둘을 나란히 놓인 별도
// 카드로 나눠 보여주는 쪽으로 정리했다). 완료 버튼은 텍스트 언더라인 스타일
// (눈에 튀지 않게 — UI 규칙), 메모는 항목마다 "+"로 추가.

import { useEffect, useState } from "react";
import useStore from "../store/useStore.js";
import { setCoopDocMemo } from "../lib/db.js";

// 2026-09-02: "캘린더 처리해야 할 일에 너무 이전 마감건까지 뜬다" 요청 — 이
// 목록은 완료 처리를 안 하면 영원히 남는데(협조문을 완료 처리 안 하고 그냥
// 지나친 경우가 실사용 중 많았음), 그러다 보니 몇 주~몇 달 지난 협조문까지
// 계속 쌓여서 정작 최근/임박 건을 찾기 어려워지는 문제가 있었다. 완료 처리를
// 강제하는 대신, 마감일이 이 유예기간(그레이스 기간)보다 더 지난 문서는 목록
// 에서만 자동으로 뺀다 — is_completed는 안 건드리므로(완료 처리를 한 건 아님)
// 캘린더 dot은 그대로 유지되고, 문서함/협조문 탭에서는 여전히 정상적으로
// 보인다. 마감일이 없는 문서는 날짜로 판단할 근거가 없으니 그대로 둔다.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OVERDUE_GRACE_DAYS = 7;
const PAGE_SIZE = 3;

function isTooOverdue(doc) {
  if (!doc.deadline) return false;
  const target = new Date(`${doc.deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysPast = Math.round((todayMid.getTime() - target.getTime()) / MS_PER_DAY);
  return daysPast > OVERDUE_GRACE_DAYS;
}

function MemoField({ value, onSave, onCancel }) {
  const [draft, setDraft] = useState(value || "");
  return (
    <div className="mt-1.5 flex items-start gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="메모를 입력하세요"
        rows={2}
        className="flex-1 text-xs border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex flex-col gap-1">
        <button
          onClick={() => onSave(draft)}
          className="text-[11px] text-brand-blue hover:text-brand-blueDark whitespace-nowrap"
        >
          저장
        </button>
        <button onClick={onCancel} className="text-[11px] text-brand-muted hover:text-brand-muted whitespace-nowrap">
          취소
        </button>
      </div>
    </div>
  );
}

export default function TaskPanel({ docs }) {
  const completeDoc = useStore((s) => s.completeDoc);
  const [editingId, setEditingId] = useState(null);
  const [page, setPage] = useState(1);

  // 2026-09-07: "메모 작성하고 완료 누르면 메모가 보여야 하는데 안 보인다"
  // 버그 수정 — 예전엔 완료 처리(is_completed=true) 즉시 목록에서 통째로
  // 빠져서 그 안에 적어둔 메모(doc.memo)도 같이 사라졌다. 이제는 완료된
  // 항목도 (그레이스 기간 안이면) 목록에 그대로 남겨서 메모를 계속 볼 수
  // 있게 하고, 대신 미완료 항목을 항상 위쪽에 먼저 보여준 뒤 완료된 항목을
  // 최근 완료순으로 그 아래에 이어붙인다.
  const relevant = docs.filter((d) => d.requires_action && !isTooOverdue(d));
  const pendingDocs = relevant
    .filter((d) => !d.is_completed)
    .sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return b.created_at - a.created_at;
    });
  const completedDocs = relevant
    .filter((d) => d.is_completed)
    .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));
  const pending = [...pendingDocs, ...completedDocs];

  const pageCount = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = pending.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    // 새로 완료 처리되거나 항목이 줄어들어 지금 페이지가 비면 이전 페이지로.
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const saveMemo = async (doc, memo) => {
    await setCoopDocMemo(doc.id, memo);
    setEditingId(null);
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-brand border border-brand-border/60">
      <h3 className="text-[15px] font-bold text-brand-navy mb-1.5">처리해야 할 일</h3>
      <p className="text-[11.5px] text-brand-muted leading-relaxed mb-3.5">
        협조문 등에서 조치가 필요하다고 판단된 항목만 자동으로 뜹니다. 완료한 항목도 메모를 볼 수 있도록 목록에
        함께 남습니다.
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-brand-muted">처리할 항목이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {pageItems.map((doc) => {
            const done = doc.is_completed;
            return (
              <li
                key={doc.id}
                className={`text-sm border rounded-lg px-3 py-2.5 ${
                  done ? "bg-white border-slate-100 opacity-70" : "bg-brand-alt/70 border-slate-100"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`text-brand-navy break-words ${done ? "line-through decoration-slate-300" : ""}`}>
                      {doc.title || "(제목 없음)"}
                    </p>
                    {doc.deadline && (
                      <span className={`text-[11px] ${done ? "text-brand-muted" : "text-amber-600"}`}>
                        마감 {doc.deadline}
                      </span>
                    )}
                    {doc.action_description && (
                      <p className="text-brand-muted text-xs mt-0.5">{doc.action_description}</p>
                    )}
                    {doc.memo && editingId !== doc.id && (
                      <p className="text-xs text-brand-muted bg-white border border-slate-100 rounded px-1.5 py-1 mt-1.5 whitespace-pre-line">
                        {doc.memo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingId(editingId === doc.id ? null : doc.id)}
                      aria-label="메모 추가"
                      className="text-brand-muted hover:text-brand-blue hover:border-blue-300 text-sm leading-none w-5 h-5 flex items-center justify-center rounded-full border border-brand-border bg-white flex-shrink-0"
                    >
                      +
                    </button>
                    {done ? (
                      <span className="text-[11px] font-medium text-emerald-600 whitespace-nowrap flex-shrink-0">
                        완료됨
                      </span>
                    ) : (
                      <button
                        onClick={() => completeDoc(doc.id)}
                        className="text-xs underline text-brand-muted hover:text-brand-muted whitespace-nowrap flex-shrink-0"
                      >
                        완료
                      </button>
                    )}
                  </div>
                </div>
                {editingId === doc.id && (
                  <MemoField
                    value={doc.memo}
                    onSave={(memo) => saveMemo(doc, memo)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pending.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2.5 mt-3.5 pt-3 border-t border-slate-100">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="w-6 h-6 rounded-full border border-brand-border text-brand-muted flex items-center justify-center disabled:opacity-30 hover:bg-brand-alt"
            aria-label="이전 페이지"
          >
            ‹
          </button>
          <span className="text-[11.5px] text-brand-muted">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="w-6 h-6 rounded-full border border-brand-border text-brand-muted flex items-center justify-center disabled:opacity-30 hover:bg-brand-alt"
            aria-label="다음 페이지"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
