// src/components/CalendarGrid.jsx
// 월간 7열 그리드. 마감일이 있는 협조문의 날짜에 dot 표시 (UI 규칙).
//
// 2026-08-23(11): "캘린더 날짜 누르고 처리해야할 일 추가"(TaskPanel과 연결)
// 요청으로 날짜 클릭 기능 추가 — selectedDate/onSelectDate/todoDaysWithDot을
// prop으로 받아 날짜를 고를 수 있게 하고, 그 날짜에 연결된 할 일이 있으면
// (마감 협조문 dot과는 다른 색으로) 표시한다.
//
// 2026-09-07(8): "일정이 있는 날은 달력에 표시되게" 요청 — 예전엔
// calendar_registered(사용자가 따로 "캘린더 등록" 누른 문서)인 경우에만
// dot을 찍어서, 마감일이 있어도 캘린더 등록을 안 한 문서는 dot이 하나도
// 안 뜨는 문제가 있었다(CoopPage.jsx의 "선택된 날짜 협조문 목록"은 애초에
// calendar_registered 여부와 무관하게 deadline만 보고 있어서 서로 기준이
// 달랐음). calendar_registered 조건을 빼고 deadline이 있는 모든 문서를
// 기준으로 통일.
//
// 2026-09-07(9): "달력에 도트 표시 안된다" 리포트 — 위 수정을 해도 여전히
// dot이 안 보였던 진짜 원인은 따로 있었음: dot 색상 클래스가
// "bg-brand-alt0"였는데, tailwind.config.js의 brand 컬러엔 navy/blue/
// blueDark/muted/border/alt만 있고 "alt0"은 애초에 정의된 적이 없는
// 오타(예전 CalendarPage.jsx 때부터 있던 오타를 그대로 복붙해온 것) — 존재
// 하지 않는 유틸리티라 Tailwind가 아무 CSS도 안 만들어서 dot이 늘 투명한
// 채로 찍혀 있었음(로직 자체는 날짜를 맞게 찾고 있었음). 실제 정의된
// brand.blue로 교체.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateStr(year, month, day) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export default function CalendarGrid({ docs, year, month, selectedDate, onSelectDate, todoDaysWithDot }) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const deadlineDaysWithDot = new Set();
  docs.forEach((doc) => {
    if (!doc.deadline) return;
    const d = new Date(doc.deadline);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === month) {
      deadlineDaysWithDot.add(d.getDate());
    }
  });

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  return (
    <div className="grid grid-cols-7 gap-1 text-center text-sm">
      {WEEKDAYS.map((d) => (
        <div key={d} className="font-medium text-brand-muted py-1">
          {d}
        </div>
      ))}
      {cells.map((day, idx) => {
        if (!day) return <div key={idx} className="h-16 rounded-xl border border-transparent" />;
        const dateStr = toDateStr(year, month, day);
        const isSelected = onSelectDate && selectedDate === dateStr;
        const hasTodoDot = todoDaysWithDot?.has(day);
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectDate?.(dateStr)}
            className={`h-16 rounded-xl border p-1 flex flex-col items-center transition ${
              isSelected
                ? "bg-brand-alt border-blue-300 ring-1 ring-blue-300"
                : "bg-white border-slate-100 hover:border-brand-border"
            }`}
          >
            <span className="text-brand-navy">{day}</span>
            <div className="flex items-center gap-0.5 mt-1">
              {deadlineDaysWithDot.has(day) && <span className="w-1.5 h-1.5 rounded-full bg-brand-blue" />}
              {hasTodoDot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
