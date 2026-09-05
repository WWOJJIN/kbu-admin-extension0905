// src/components/CalendarPage.jsx
// 캘린더 탭 전체. 2026-09-02 레이아웃 개편 — 팀에서 공유한 화면 구성(달력 |
// 처리해야 할 일 | 투두리스트+메모, 3열)에 맞춰 바꿨다. 예전엔 달력(2/3) +
// TaskPanel·NotesPanel을 한 컬럼에 세로로 쌓은 2열 구성이었는데, "자동으로
// 뜨는 처리해야 할 일"과 "내가 직접 쓰는 투두리스트"를 나란히 별도 카드로
// 두는 쪽을 원해서 TaskPanel.jsx를 문서 전용으로 좁히고 TodoListPanel.jsx를
// 새로 뺐다. 카드 스타일도 팀이 공유한 목업(그림자 있는 둥근 카드, ambient
// shadow)에 맞춰 shadow-brand + rounded-2xl로 통일.

import { useEffect, useMemo, useState } from "react";
import useStore from "../store/useStore.js";
import CalendarGrid from "./CalendarGrid.jsx";
import TaskPanel from "./TaskPanel.jsx";
import TodoListPanel from "./TodoListPanel.jsx";
import NotesPanel from "./NotesPanel.jsx";
import { getAllTodos } from "../lib/db.js";

function toDateStr(year, month, day) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function todayStr() {
  const now = new Date();
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
}

function offsetDateStr(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

// 2026-08-23(12): "캘린더 쪽도 샘플로 보기 하나 넣어줘" 요청 — BriefingPage와
// 같은 목적(레이아웃 확인용, 실제 IndexedDB는 안 건드림). 협조문 마감 dot +
// 할 일 dot이 한 달 안에 여러 개 흩어져 보이도록 날짜를 오늘 기준 오프셋으로 둠.
function buildSampleDocs() {
  const raw = [
    { title: "2026년 하반기 신규채용 인력 수요조사 안내", sender_dept: "인사팀", deadlineOffset: 1 },
    { title: "3분기 부서별 예산 집행 현황 보고", sender_dept: "재무팀", deadlineOffset: 4 },
    { title: "사내 네트워크 정기 점검 안내", sender_dept: "IT지원팀", deadlineOffset: -2 },
    { title: "산학협력단 회계 마감 일정 안내", sender_dept: "산학협력단", deadlineOffset: 9 },
  ];
  return raw.map((r, i) => ({
    id: `sample-cal-${i}`,
    title: r.title,
    sender_dept: r.sender_dept,
    deadline: offsetDateStr(r.deadlineOffset),
    calendar_registered: true,
    is_completed: false,
  }));
}

function buildSampleTodos() {
  const raw = [
    { text: "교무위원회 회의실 대관 협조문 초안 작성", dateOffset: 0 },
    { text: "연구비 정산 지침 안내 검토", dateOffset: 2 },
    { text: "신규 협조문 서식 취합", dateOffset: 5 },
  ];
  return raw.map((r, i) => ({
    id: `sample-todo-${i}`,
    text: r.text,
    done: false,
    memo: null,
    date: offsetDateStr(r.dateOffset),
    created_at: Date.now(),
  }));
}

export default function CalendarPage() {
  const coopDocs = useStore((s) => s.coopDocs);
  const loadCoopDocs = useStore((s) => s.loadCoopDocs);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // 2026-08-23(11): "캘린더에서 날짜 누르고 처리해야할 일 추가/연결" 요청 —
  // todos를 이 화면이 갖고 있다가(캘린더 dot 표시에도 같은 데이터가 필요해서)
  // TodoListPanel엔 props로 내려준다. selectedDate는 CalendarGrid 클릭으로
  // 바뀌고, TodoListPanel의 새 할 일 추가 폼 기본 날짜로 쓰인다.
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [todos, setTodos] = useState([]);
  const refreshTodos = () => getAllTodos().then(setTodos);

  // 2026-08-23(12): 레이아웃 확인용 샘플 토글 — 실제 IndexedDB는 안 건드리고
  // 화면에 보여주는 데이터만 바꿔치기한다(BriefingPage의 usingSample과 동일한 패턴).
  const [usingSample, setUsingSample] = useState(false);
  const sampleDocs = useMemo(() => buildSampleDocs(), []);
  const sampleTodos = useMemo(() => buildSampleTodos(), []);
  const effectiveDocs = usingSample ? sampleDocs : coopDocs;
  const effectiveTodos = usingSample ? sampleTodos : todos;

  useEffect(() => {
    loadCoopDocs();
    refreshTodos();
  }, [loadCoopDocs]);

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
  });

  const goPrevMonth = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const goNextMonth = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));

  const todoDaysWithDot = useMemo(() => {
    const set = new Set();
    effectiveTodos.forEach((t) => {
      if (t.done || !t.date) return;
      const d = new Date(`${t.date}T00:00:00`);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() === cursor.year && d.getMonth() === cursor.month) {
        set.add(d.getDate());
      }
    });
    return set;
  }, [effectiveTodos, cursor]);

  const selectedDateLabel = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })
    : "";

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-brand-navy">캘린더 &amp; 메모</h2>
        <p className="text-sm text-brand-muted mt-0.5">일정과 할 일을 관리하고 빠른 메모를 작성하세요.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* 달력 */}
        <div className="lg:col-span-6 bg-white rounded-2xl p-5 shadow-brand border border-brand-border/60">
          <div className="flex items-center justify-between mb-4">
            <button onClick={goPrevMonth} className="px-2 text-brand-muted hover:text-brand-navy" aria-label="이전 달">
              ←
            </button>
            <h2 className="text-[15px] font-bold text-brand-navy">{monthLabel}</h2>
            <button onClick={goNextMonth} className="px-2 text-brand-muted hover:text-brand-navy" aria-label="다음 달">
              →
            </button>
          </div>
          <CalendarGrid
            docs={effectiveDocs}
            year={cursor.year}
            month={cursor.month}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            todoDaysWithDot={todoDaysWithDot}
          />
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <p className="text-xs text-brand-muted">{selectedDateLabel} 선택됨 — 오른쪽에서 이 날짜로 할 일 추가</p>
            <p className="text-[11px] text-brand-muted flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-alt0 inline-block" /> 협조문 마감
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" /> 할 일
              </span>
            </p>
          </div>
          {/* 2026-08-23(12): "캘린더 쪽도 샘플로 보기 넣어줘" 요청 — 실제 데이터가
              적을 때도 dot/레이아웃을 미리 볼 수 있게. */}
          <button
            onClick={() => setUsingSample((v) => !v)}
            className={`mt-3 text-xs px-2.5 py-1.5 rounded-md border ${
              usingSample
                ? "bg-brand-alt border-blue-300 text-brand-blueDark"
                : "border-brand-border text-brand-muted hover:bg-brand-alt"
            }`}
          >
            {usingSample ? "실제 데이터로 보기" : "샘플로 미리보기"}
          </button>
        </div>

        {/* 처리해야 할 일 (자동 판별, 문서 전용) */}
        <div className="lg:col-span-3">
          <TaskPanel docs={effectiveDocs} />
        </div>

        {/* 투두리스트 + 메모 */}
        <div className="lg:col-span-3 flex flex-col gap-5">
          <TodoListPanel todos={effectiveTodos} onRefresh={refreshTodos} selectedDate={selectedDate} />
          <NotesPanel />
        </div>
      </div>
    </div>
  );
}
