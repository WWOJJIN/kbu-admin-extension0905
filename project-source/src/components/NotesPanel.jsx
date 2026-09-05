// src/components/NotesPanel.jsx
// 캘린더 탭 하단 "메모" — 특정 할 일/문서에 매이지 않는 자유 메모장.
// 2026-08-23(4) 추가 (Stitch 시안: 투두 리스트 상단 / 메모 하단 분리 요청).
// 2026-08-23(11): "제목 작성하면 제목이 리스트로 저장되고, 누르면 내용이
// 펼쳐지게" 요청 — 제목/내용 입력을 분리하고, 목록엔 제목만 보이다가 클릭하면
// 아코디언처럼 펼쳐지도록 변경. 예전에 저장된(제목 없는) 메모는 본문 앞부분을
// 제목 대신 보여준다.

import { useEffect, useMemo, useState } from "react";
import { addNote, getAllNotes, deleteNote } from "../lib/db.js";

function noteTitle(note) {
  if (note.title && note.title.trim()) return note.title.trim();
  const firstLine = (note.text || "").split("\n")[0].trim();
  return firstLine ? firstLine.slice(0, 30) : "(제목 없음)";
}

export default function NotesPanel() {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");

  const refresh = () => getAllNotes().then(setNotes);

  useEffect(() => {
    refresh();
  }, []);

  const add = async () => {
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (!trimmedTitle && !trimmedText) return;
    // 제목을 안 썼으면 내용 첫 줄을 제목 대신 씀(noteTitle과 동일한 규칙) —
    // 그래도 최소한 뭐라도 리스트에 뜨게 하기 위함.
    await addNote(trimmedTitle, trimmedText);
    setTitle("");
    setText("");
    refresh();
  };

  const remove = async (id) => {
    await deleteNote(id);
    if (expandedId === id) setExpandedId(null);
    refresh();
  };

  // 2026-09-02 추가: 메모가 쌓이면 스크롤해서 찾기 번거로워서 제목+본문
  // 기준 간단 검색을 넣었다. 서버 조회 없이 클라이언트에서 그냥 필터.
  const visibleNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter(
      (n) => (n.title || "").toLowerCase().includes(query) || (n.text || "").toLowerCase().includes(query)
    );
  }, [notes, search]);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-brand border border-brand-border/60">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-bold text-brand-navy flex-shrink-0">메모</h3>
        <div className="relative flex-1 max-w-[180px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted text-xs">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="메모 검색"
            className="w-full text-xs border border-brand-border rounded-md pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="제목"
          className="w-full text-sm border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <div className="flex items-start gap-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="내용 (제목을 누르면 펼쳐져서 보여요)"
            rows={2}
            className="flex-1 text-sm border border-brand-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button onClick={add} className="text-sm text-brand-blue hover:text-brand-blueDark px-2 flex-shrink-0">
            추가
          </button>
        </div>
      </div>
      {visibleNotes.length === 0 ? (
        <p className="text-sm text-brand-muted">
          {notes.length === 0 ? "아직 메모가 없습니다." : "검색 결과가 없습니다."}
        </p>
      ) : (
        // 2026-08-23(12): "UI 좀 이쁘게" 요청 — 항목에 테두리+hover를 줘서
        // TaskPanel과 톤을 맞추고, 삭제 버튼을 원형 아이콘 버튼으로 통일.
        <ul className="space-y-1.5">
          {visibleNotes.map((note) => {
            const isOpen = expandedId === note.id;
            return (
              <li
                key={note.id}
                className="bg-brand-alt/70 border border-slate-100 rounded-lg overflow-hidden hover:border-brand-border transition"
              >
                <button
                  onClick={() => setExpandedId(isOpen ? null : note.id)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="text-sm text-brand-navy truncate min-w-0">{noteTitle(note)}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-slate-300 text-[10px]">{isOpen ? "▲" : "▼"}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(note.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          remove(note.id);
                        }
                      }}
                      aria-label="메모 삭제"
                      className="text-brand-muted hover:text-red-500 hover:border-red-300 text-xs w-5 h-5 flex items-center justify-center rounded-full border border-brand-border bg-white"
                    >
                      ✕
                    </span>
                  </span>
                </button>
                {isOpen && note.text && (
                  <p className="text-sm text-brand-muted whitespace-pre-line bg-white px-3 py-2.5 border-t border-slate-100">
                    {note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
