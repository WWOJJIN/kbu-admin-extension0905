// src/components/CalendarGrid.jsx
// 월간 7열 그리드. 캘린더 등록 완료된 협조문의 마감일에 dot 표시 (UI 규칙).
//
// 2026-08-23(11): "캘린더 날짜 누르고 처리해야할 일 추가"(TaskPanel과 연결)
// 요청으로 날짜 클릭 기능 추가 — selectedDate/onSelectDate/todoDaysWithDot을
// prop으로 받아 날짜를 고를 수 있게 하고, 그 날짜에 연결된 할 일이 있으면
// (마감 협조문 dot과는 다른 색으로) 표시한다.

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
    if (!doc.calendar_registered || !doc.deadline) return;
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
              {deadlineDaysWithDot.has(day) && <span className="w-1.5 h-1.5 rounded-full bg-brand-alt0" />}
              {hasTodoDot && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
