// src/components/BriefingPage.jsx
// 오늘의 브리핑 탭 — 대시보드 형식. 상단 통계 타일(클릭 시 아래 리스트
// 필터/스크롤) + 마감 임박 / 액션 필요·참고용 2단 패널 + 우측 미니 캘린더
// (날짜 클릭 시 그 날짜의 항목을 옆 패널에 표시). 별도 API 호출 없이 이미
// 로드된 coopDocs를 가공만 해서 보여줌(2026-08-23 추가, 08-23(2) 대시보드
// 개편).

import { useEffect, useMemo, useRef, useState } from "react";
import useStore from "../store/useStore.js";
// 2026-09-07: "최근 한 달치만 불러오도록" 요청 — 아래 RECENT_DOC_DAYS(30, "새
// 문서" 배지 판정용 상수)와는 목적이 달라서 이름 충돌 없게 별칭으로 가져옴.
import { isWithinRecentDays, RECENT_DOCS_DAYS as LOAD_RECENT_DAYS } from "../lib/textUtils.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEADLINE_HORIZON_DAYS = 14; // "이번주 마감" 패널 — 사용자 요청으로 넉넉히 2주 범위까지 보여줌
const RECENT_DOC_DAYS = 30; // 2026-08-26: 개발 중이라 테스트 데이터가 잘 보이게 7일 -> 30일(약 한 달)로 임시 상향. 운영 배포 전에 다시 검토할 것. // "새 문서" 기준 — is_new 플래그 대신 기안일(date) 최근 1주로 재정의
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function todayStr() {
  const now = new Date();
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateStr(year, month, day) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function daysUntil(dateStr) {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayMid.getTime()) / MS_PER_DAY);
}

function offsetDateStr(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * 레이아웃 확인용 샘플 데이터. deadline이 실제로는 AI 파싱(프록시 서버 미배포로
 * 아직 없음) 없이는 항상 비어있어서, 실 계정 데이터만으로는 "마감 임박"/"오늘
 * 마감" 같은 패널이 전부 0으로 보여 레이아웃 확인이 안 됨 — 우진 요청으로 추가한
 * 미리보기 전용 데이터(2026-08-23(3)). 실제 IndexedDB는 건드리지 않는다.
 */
function buildSampleDocs() {
  const raw = [
    { title: "2026년 하계 워크숍 참가 신청", sender_dept: "기획처", recv_dept_name: "혁신지원사업단", dateOffset: -2, deadlineOffset: 0, requires_action: true },
    { title: "혁신지원사업 성과평가 자료 제출", sender_dept: "혁신지원사업단", recv_dept_name: "혁신지원사업단", dateOffset: -4, deadlineOffset: 3, requires_action: true },
    { title: "예산 편성 검토 협조 요청", sender_dept: "사무처", recv_dept_name: "산학협력단", dateOffset: -1, deadlineOffset: 6, requires_action: true },
    { title: "2학기 수강신청 일정 안내", sender_dept: "교무처", recv_dept_name: "혁신지원사업단", dateOffset: -1, deadlineOffset: null, requires_action: false },
    { title: "교직원 복지포인트 신청 안내", sender_dept: "총무과", recv_dept_name: "산단 사무국", dateOffset: -2, deadlineOffset: null, requires_action: false },
    { title: "여름철 전력 절감 캠페인 안내", sender_dept: "총무과", recv_dept_name: "혁신지원사업단", dateOffset: -5, deadlineOffset: null, requires_action: false },
    { title: "청사 방역 소독 실시 안내", sender_dept: "시설관리팀", recv_dept_name: "혁신지원사업단", dateOffset: -6, deadlineOffset: null, requires_action: false },
    { title: "출장비 정산 서류 제출", sender_dept: "회계팀", recv_dept_name: "산학협력단", dateOffset: -3, deadlineOffset: 1, requires_action: true },
    { title: "산학협력단 회계 마감 일정 안내", sender_dept: "산학협력단", recv_dept_name: "산학협력단", dateOffset: -9, deadlineOffset: 9, requires_action: false },
    { title: "2026학년도 운영계획서 제출 안내", sender_dept: "기획팀", recv_dept_name: "혁신지원사업단", dateOffset: -1, deadlineOffset: 13, requires_action: true },
  ];
  return raw.map((r, i) => ({
    id: `sample-${i}`,
    title: r.title,
    sender_dept: r.sender_dept,
    recv_dept_name: r.recv_dept_name,
    date: offsetDateStr(r.dateOffset),
    deadline: r.deadlineOffset === null ? null : offsetDateStr(r.deadlineOffset),
    requires_action: r.requires_action,
    is_completed: false,
    created_at: Date.now() + r.dateOffset * MS_PER_DAY,
  }));
}

function DeadlineTag({ deadline }) {
  const d = daysUntil(deadline);
  if (d === null) return <span className="text-xs text-brand-muted flex-shrink-0">{deadline}</span>;
  if (d < 0)
    return <span className="text-xs font-semibold text-red-600 flex-shrink-0">{Math.abs(d)}일 지남</span>;
  if (d === 0) return <span className="text-xs font-semibold text-red-600 flex-shrink-0">오늘</span>;
  return <span className="text-xs font-semibold text-amber-600 flex-shrink-0">D-{d}</span>;
}

function StatTile({ label, value, accent, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border rounded-xl px-4 py-3 transition ${
        active ? "border-blue-400 ring-1 ring-blue-300" : "border-brand-border hover:border-brand-border"
      }`}
    >
      <p className="text-xs text-brand-muted mb-1.5">{label}</p>
      <p className="text-2xl font-medium" style={{ color: accent }}>
        {value}
      </p>
    </button>
  );
}

function Panel({ title, count, panelRef, highlighted, children }) {
  return (
    <div
      ref={panelRef}
      className={`bg-white border rounded-xl p-4 transition ${
        highlighted ? "border-blue-400 ring-1 ring-blue-300" : "border-brand-border"
      }`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-medium text-brand-navy">{title}</p>
        {count > 0 && <span className="text-xs text-brand-muted">{count}</span>}
      </div>
      {children}
    </div>
  );
}

export default function BriefingPage() {
  const allCoopDocs = useStore((s) => s.coopDocs);
  const loadCoopDocs = useStore((s) => s.loadCoopDocs);
  const openDetail = useStore((s) => s.openDetail);
  const completeDoc = useStore((s) => s.completeDoc);
  const setActiveTab = useStore((s) => s.setActiveTab);

  // 2026-09-07: "최근 한 달치만 불러오도록" — 브리핑 탭도 기안일(date) 기준
  // 최근 30일 문서만 대상으로 통계/패널을 구성한다. store.coopDocs 자체는
  // 그대로 두고(useStore.js 참고) 표시 직전에만 한 번 더 거른다.
  const coopDocs = useMemo(
    () => allCoopDocs.filter((d) => isWithinRecentDays(d.date, LOAD_RECENT_DAYS)),
    [allCoopDocs]
  );

  const [usingSample, setUsingSample] = useState(false); // 레이아웃 확인용 샘플 데이터 토글
  const sampleDocs = useMemo(() => buildSampleDocs(), []);
  const effectiveDocs = usingSample ? sampleDocs : coopDocs;

  const [deadlineFilter, setDeadlineFilter] = useState(null); // null | "today"
  const [highlightPanel, setHighlightPanel] = useState(null); // null | "deadline" | "action"
  const [sideMode, setSideMode] = useState("date"); // "date" | "new"
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const deadlinePanelRef = useRef(null);
  const actionPanelRef = useRef(null);

  useEffect(() => {
    loadCoopDocs();
  }, [loadCoopDocs]);

  useEffect(() => {
    if (!highlightPanel) return;
    const t = setTimeout(() => setHighlightPanel(null), 900);
    return () => clearTimeout(t);
  }, [highlightPanel]);

  const openDoc = (id) => {
    if (usingSample) return; // 샘플 데이터는 IndexedDB에 없는 가짜 id라 상세 팝업을 열 수 없음
    openDetail(id); // 브리핑 화면에 그대로 머무름 — 탭 이동 없이 상세 팝업만 뜨도록
  };

  // ── 마감 임박(2주 범위) ────────────────────────────────────────────
  const deadlineHorizon = useMemo(() => {
    return effectiveDocs
      .filter((d) => d.deadline && !d.is_completed)
      .map((d) => ({ ...d, _daysUntil: daysUntil(d.deadline) }))
      .filter((d) => d._daysUntil !== null && d._daysUntil <= DEADLINE_HORIZON_DAYS)
      .sort((a, b) => a._daysUntil - b._daysUntil);
  }, [effectiveDocs]);

  const todayDeadlineCount = deadlineHorizon.filter((d) => d._daysUntil === 0).length;
  const weekDeadlineCount = deadlineHorizon.filter((d) => d._daysUntil >= 0).length;
  const deadlineList = (deadlineFilter === "today"
    ? deadlineHorizon.filter((d) => d._daysUntil === 0)
    : deadlineHorizon
  ).slice(0, 5);

  // ── 액션 필요 / 참고용 ────────────────────────────────────────────
  const needsAction = useMemo(
    () =>
      effectiveDocs
        .filter((d) => d.requires_action && !d.is_completed)
        .sort((a, b) => {
          if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
          if (a.deadline) return -1;
          if (b.deadline) return 1;
          return (b.created_at || 0) - (a.created_at || 0);
        }),
    [effectiveDocs]
  );

  // ── AI 업무 요약(상단 하이라이트 카드) ─────────────────────────────
  // 2026-08-23(11): "브리핑 상단에 AI 업무 요약 카드가 있으면 좋겠다"(Stitch
  // 시안 1번) 요청 — needsAction 중 마감이 가장 급한 순으로 최대 3건만 뽑아
  // 짧은 요약 줄로 보여준다. 새 API 호출 없이 이미 있는 ai_summary/
  // action_description을 재사용(프록시 미배포라 지금은 대부분 비어있어서
  // sender_dept로 폴백).
  const aiHighlights = useMemo(() => needsAction.slice(0, 3), [needsAction]);

  // requires_action이 false거나(참고성) 아직 AI 파싱이 안 돼 값이 없는 문서(프록시
  // 미배포 상태라 지금은 대부분 이쪽) 전부 "참고용"으로 묶는다.
  const forReference = useMemo(
    () =>
      effectiveDocs
        .filter((d) => !d.requires_action && !d.is_completed)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [effectiveDocs]
  );

  // ── 새 문서(최근 1주, 기안일 기준) ──────────────────────────────────
  const recentDocs = useMemo(() => {
    return effectiveDocs
      .map((d) => ({ ...d, _daysSince: d.date ? -daysUntil(d.date) : null }))
      .filter((d) => d._daysSince !== null && d._daysSince >= 0 && d._daysSince <= RECENT_DOC_DAYS)
      .sort((a, b) => a._daysSince - b._daysSince);
  }, [effectiveDocs]);

  // ── 미니 캘린더 ──────────────────────────────────────────────────
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("ko-KR", { month: "long" });
  const firstDay = new Date(cursor.year, cursor.month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  const dotByDay = useMemo(() => {
    const map = new Map();
    effectiveDocs.forEach((doc) => {
      if (!doc.deadline || doc.is_completed) return;
      const d = new Date(`${doc.deadline}T00:00:00`);
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== cursor.year || d.getMonth() !== cursor.month) return;
      const du = daysUntil(doc.deadline);
      const color = du <= 0 ? "bg-red-500" : du <= DEADLINE_HORIZON_DAYS ? "bg-amber-500" : "bg-slate-300";
      const existing = map.get(d.getDate());
      if (!existing || color === "bg-red-500") map.set(d.getDate(), color);
    });
    return map;
  }, [effectiveDocs, cursor]);

  const goPrevMonth = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const goNextMonth = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));

  const pickDate = (dateStr) => {
    setSelectedDate(dateStr);
    setSideMode("date");
  };

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  // ── 우측 사이드 패널 내용 ────────────────────────────────────────
  const sideDocs =
    sideMode === "new"
      ? recentDocs
      : effectiveDocs.filter((d) => d.deadline === selectedDate).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const sideTitle =
    sideMode === "new"
      ? "최근 1주 새 문서"
      : `${new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 마감`;

  const clickTodayTile = () => {
    setDeadlineFilter((f) => (f === "today" ? null : "today"));
    setHighlightPanel("deadline");
    deadlinePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const clickWeekTile = () => {
    setDeadlineFilter(null);
    setHighlightPanel("deadline");
    deadlinePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const clickActionTile = () => {
    setHighlightPanel("action");
    actionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const clickNewTile = () => setSideMode("new");

  const dateLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">오늘의 브리핑</h2>
          <p className="text-sm text-brand-muted mt-0.5">{dateLabel}</p>
        </div>
        <button
          onClick={() => setUsingSample((v) => !v)}
          className={`text-xs px-2.5 py-1.5 rounded-md border flex-shrink-0 ${
            usingSample ? "bg-brand-alt border-blue-300 text-brand-blueDark" : "border-brand-border text-brand-muted hover:bg-brand-alt"
          }`}
        >
          {usingSample ? "실제 데이터로 보기" : "샘플로 미리보기"}
        </button>
      </div>

      {/* 2026-08-23(11): AI 업무 요약 카드 (Stitch 시안 1번 반영) — 처리해야 할
          항목 중 마감 급한 순 최대 3건을 짧게 요약해서 보여주고, "협조문
          전체보기"로 바로 협조문 탭(신규 필터)으로 이동. */}
      <div className="bg-brand-alt border border-blue-100 rounded-xl px-4 py-3.5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-blue-900">✨ AI 업무 요약</p>
          <button
            onClick={() => setActiveTab("coop")}
            className="text-xs text-brand-blue hover:text-blue-800 font-medium flex-shrink-0"
          >
            협조문 전체보기 →
          </button>
        </div>
        {aiHighlights.length === 0 ? (
          <p className="text-sm text-brand-blueDark/70">지금 처리할 항목이 없어요.</p>
        ) : (
          <ul className="space-y-1.5">
            {aiHighlights.map((doc) => {
              const detail = doc.ai_summary?.split("\n")[0] || doc.action_description || doc.sender_dept || "";
              return (
                <li key={doc.id} className="text-sm">
                  <button onClick={() => openDoc(doc.id)} className="text-left w-full">
                    <span className="text-blue-900 font-medium">{doc.title || "(제목 없음)"}</span>
                    {detail && <span className="text-brand-blueDark/80"> — {detail}</span>}
                    {doc.deadline && <DeadlineTag deadline={doc.deadline} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="오늘 마감"
          value={todayDeadlineCount}
          accent="#DC2626"
          active={deadlineFilter === "today"}
          onClick={clickTodayTile}
        />
        <StatTile label="이번주 마감" value={weekDeadlineCount} accent="#D97706" active={false} onClick={clickWeekTile} />
        <StatTile label="액션 필요" value={needsAction.length} accent="#2563EB" active={false} onClick={clickActionTile} />
        <StatTile label="새 문서" value={recentDocs.length} accent="#64748B" active={sideMode === "new"} onClick={clickNewTile} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3 items-start">
        <div className="space-y-3 min-w-0">
          <Panel title="마감 임박" count={deadlineList.length} panelRef={deadlinePanelRef} highlighted={highlightPanel === "deadline"}>
            {deadlineList.length === 0 ? (
              <p className="text-sm text-brand-muted">해당하는 문서가 없어요.</p>
            ) : (
              <ul>
                {deadlineList.map((doc) => (
                  <li key={doc.id} className="border-b border-slate-100 last:border-b-0">
                    <button
                      onClick={() => openDoc(doc.id)}
                      className="w-full text-left flex items-center gap-2 py-2 hover:bg-brand-alt -mx-1 px-1 rounded-md"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          doc._daysUntil <= 0 ? "bg-red-500" : "bg-amber-500"
                        }`}
                      />
                      <span className="flex-1 min-w-0 text-sm text-brand-navy truncate">{doc.title || "(제목 없음)"}</span>
                      <DeadlineTag deadline={doc.deadline} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Panel title="액션 필요" count={needsAction.length} panelRef={actionPanelRef} highlighted={highlightPanel === "action"}>
              {needsAction.length === 0 ? (
                <p className="text-sm text-brand-muted">처리할 항목이 없어요.</p>
              ) : (
                <ul>
                  {needsAction.slice(0, 5).map((doc) => (
                    <li key={doc.id} className="border-b border-slate-100 last:border-b-0 py-1.5">
                      <button onClick={() => openDoc(doc.id)} className="w-full text-left">
                        <p className="text-sm text-brand-navy truncate">{doc.title || "(제목 없음)"}</p>
                      </button>
                      <button
                        onClick={() => completeDoc(doc.id)}
                        className="text-xs underline text-brand-muted hover:text-brand-muted mt-0.5"
                      >
                        완료
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="참고용 · 공지" count={forReference.length}>
              {forReference.length === 0 ? (
                <p className="text-sm text-brand-muted">해당하는 문서가 없어요.</p>
              ) : (
                <ul>
                  {forReference.slice(0, 5).map((doc) => (
                    <li key={doc.id} className="border-b border-slate-100 last:border-b-0 py-1.5">
                      <button onClick={() => openDoc(doc.id)} className="w-full text-left">
                        <p className="text-sm text-brand-navy truncate">{doc.title || "(제목 없음)"}</p>
                        <p className="text-xs text-brand-muted truncate mt-0.5">{doc.sender_dept}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-white border border-brand-border rounded-xl p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-medium text-brand-navy">{monthLabel}</span>
              <div className="flex gap-1">
                <button onClick={goPrevMonth} className="text-brand-muted hover:text-brand-navy px-1">
                  ‹
                </button>
                <button onClick={goNextMonth} className="text-brand-muted hover:text-brand-navy px-1">
                  ›
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-[10px] text-brand-muted">
                  {w}
                </span>
              ))}
              {cells.map((day, idx) => {
                if (!day) return <span key={idx} />;
                const dateStr = toDateStr(cursor.year, cursor.month, day);
                const isSelected = dateStr === selectedDate && sideMode === "date";
                const isToday = dateStr === todayStr();
                const dot = dotByDay.get(day);
                return (
                  <button
                    key={idx}
                    onClick={() => pickDate(dateStr)}
                    className={`relative text-xs w-6 h-6 mx-auto rounded-full flex items-center justify-center ${
                      isSelected
                        ? "bg-brand-blue text-white"
                        : isToday
                        ? "text-brand-blue font-semibold"
                        : "text-brand-muted hover:bg-brand-alt"
                    }`}
                  >
                    {day}
                    {dot && !isSelected && (
                      <span className={`absolute bottom-0 w-1 h-1 rounded-full ${dot}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <Panel title={sideTitle} count={sideDocs.length}>
            {sideDocs.length === 0 ? (
              <p className="text-sm text-brand-muted">해당하는 문서가 없어요.</p>
            ) : (
              <ul>
                {sideDocs.slice(0, 6).map((doc) => (
                  <li key={doc.id} className="border-b border-slate-100 last:border-b-0 py-1.5">
                    <button onClick={() => openDoc(doc.id)} className="w-full text-left">
                      <p className="text-[13px] text-brand-navy truncate">{doc.title || "(제목 없음)"}</p>
                      <p className="text-[11px] text-brand-muted truncate mt-0.5">
                        {doc.sender_dept}
                        {doc.date && ` · ${doc.date}`}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
