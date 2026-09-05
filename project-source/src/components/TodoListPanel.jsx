// src/components/TodoListPanel.jsx
// "투두리스트" — 사용자가 직접 추가하는 자유 할 일. 2026-09-02에 TaskPanel.jsx
// (자동 판별 "처리해야 할 일")에서 분리했다 — 팀에서 공유한 화면 구성이 두
// 카드를 나란히 배치하는 형태였고, "자동으로 뜨는 것" vs "내가 직접 추가하는
// 것"을 한 리스트에 섞는 것보다 분리하는 쪽이 더 명확했다.

import { useEffect, useState } from "react";
import { addTodo, toggleTodoDone, setTodoMemo, setTodoDate } from "../lib/db.js";

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

export default function TodoListPanel({ todos = [], onRefresh, selectedDate }) {
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState(selectedDate || "");
  const [editingId, setEditingId] = useState(null);

  // 캘린더에서 다른 날짜를 고르면(selectedDate 변경) 새 할 일 입력창의 기본
  // 날짜도 같이 따라가게 함 — 날짜를 고르고 바로 여기에 입력하는 흐름.
  useEffect(() => {
    if (selectedDate) setNewDate(selectedDate);
  }, [selectedDate]);

  const pending = todos.filter((t) => !t.done);

  const add = async () => {
    const text = newText.trim();
    if (!text) return;
    await addTodo(text, newDate || null);
    setNewText("");
    onRefresh?.();
  };

  const complete = (todo) => toggleTodoDone(todo.id).then(() => onRefresh?.());

  const saveMemo = async (todo, memo) => {
    await setTodoMemo(todo.id, memo);
    setEditingId(null);
    onRefresh?.();
  };

  const changeDate = async (todo, date) => {
    await setTodoDate(todo.id, date || null);
    onRefresh?.();
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-brand border border-brand-border/60">
      <h3 className="text-[15px] font-bold text-brand-navy mb-3">투두리스트</h3>

      {pending.length === 0 ? (
        <p className="text-sm text-brand-muted">할 일이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {pending.map((todo) => {
            const editing = editingId === todo.id;
            return (
              <li key={todo.id} className="text-sm bg-brand-alt/70 border border-slate-100 rounded-lg px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-brand-navy break-words">{todo.text}</p>
                    <input
                      type="date"
                      value={todo.date || ""}
                      onChange={(e) => changeDate(todo, e.target.value)}
                      className="mt-1 w-[124px] flex-shrink-0 text-[11px] text-brand-muted border border-brand-border rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {todo.memo && !editing && (
                      <p className="text-xs text-brand-muted bg-white border border-slate-100 rounded px-1.5 py-1 mt-1.5 whitespace-pre-line">
                        {todo.memo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingId(editing ? null : todo.id)}
                      aria-label="메모 추가"
                      className="text-brand-muted hover:text-brand-blue hover:border-blue-300 text-sm leading-none w-5 h-5 flex items-center justify-center rounded-full border border-brand-border bg-white flex-shrink-0"
                    >
                      +
                    </button>
                    <button
                      onClick={() => complete(todo)}
                      className="text-xs underline text-brand-muted hover:text-brand-muted whitespace-nowrap flex-shrink-0"
                    >
                      완료
                    </button>
                  </div>
                </div>
                {editing && (
                  <MemoField
                    value={todo.memo}
                    onSave={(memo) => saveMemo(todo, memo)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 mt-3.5 pt-3 border-t border-slate-100">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="새로운 할 일 추가..."
          className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="flex-1 min-w-0 text-sm border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={add}
            className="text-sm text-brand-blue hover:text-brand-blueDark px-2 flex-shrink-0"
            aria-label="할 일 추가"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
