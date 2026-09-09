// src/components/CoopPage.jsx
// 협조문 탭 전체.
//
// 2026-09-07: "협조문이랑 캘린더페이지랑 합치자" 요청으로 캘린더 탭을 이
// 페이지에 흡수했다. 왼쪽엔 협조문 카드(2열), 오른쪽엔 달력 + 처리해야 할 일
// (TaskPanel)을 배치. 투두리스트/메모(TodoListPanel.jsx/NotesPanel.jsx)는
// 요청대로 이 화면에서 뺐다 — 두 컴포넌트 파일 자체는 그대로 남아있지만
// 캘린더 탭이 없어지면서 더 이상 어디서도 쓰이지 않는다. 그에 맞춰 캘린더
// dot도 협조문 마감(deadline)만 남기고, 투두 dot/날짜 선택 기능은 뺐다
// (선택 기능은 TodoListPanel에 새 할 일 날짜를 채워주기 위한 용도였는데,
// 그 패널 자체가 없어졌으므로). 네브바의 "캘린더" 탭과 App.jsx의 관련 라우팅도
// 같이 정리했다(Navbar.jsx/App.jsx 참고). 예전 CalendarPage.jsx/
// CalendarGrid.jsx는 그대로 남겨뒀고, CalendarGrid는 이 페이지에서 계속
// 재사용한다.
//
// 2026-09-07(2): "최근 한 달치만 불러오도록" 요청 — 협조문(이 페이지)·
// 캘린더(=이 페이지에 흡수됨)·브리핑 탭이 공유하는 store.coopDocs 전체가
// 아니라, 기안일(doc.date) 기준 최근 30일 문서만 걸러서 화면에 보여준다.
// store.coopDocs 자체(useStore.js loadCoopDocs)는 그대로 전체를 유지한다 —
// backfillMissingDrafters/pruneOutOfScopeCoopDocs 같은 내부 정리 로직은 오래된
// 문서도 계속 봐야 하기 때문에, 필터링은 화면 표시 시점(이 컴포넌트)에서만
// 한 번 더 건다.
//
// 2026-09-07(3): "협조문 탭에서는 AI요약 전부 다 보이게" 요청 — 설정 탭의
// 펼침 정책(summarySettings: 전부펼쳐보기/최근만/읽은건접기)은 그대로 두되,
// 이 탭의 카드에는 CoopCard의 forceExpanded prop을 true로 내려줘서 정책과
// 무관하게 항상 펼쳐서 보여준다(다른 곳에서 CoopCard를 다시 쓰게 되면 그
// 쪽은 원래 정책을 그대로 따르도록 prop 기본값은 false로 둠).
//
// 2026-09-07(5): Stitch로 뽑아본 시안 중 "배치/형태만" 반영해달라는 요청 —
// 새 데이터 필드(직급 등)나 정렬/필터 버튼, 하단 상태 위젯은 추가하지 않고,
// 캘린더 날짜를 눌러 그 날짜가 마감인 협조문을 바로 훑어볼 수 있게 하는
// 배치만 되살렸다(예전 CalendarPage.jsx에 있던 selectedDate 클릭 기능 —
// 단, 그때 같이 쓰던 투두(todoDaysWithDot)는 부활시키지 않고 협조문
// 마감(deadline)만 기준으로 삼는다).

import { useEffect, useMemo, useState } from "react";
import useStore from "../store/useStore.js";
import CoopCard from "./CoopCard.jsx";
import CalendarGrid from "./CalendarGrid.jsx";
import TaskPanel from "./TaskPanel.jsx";
// CoopDetailModal은 App.jsx로 옮김 — 브리핑 탭 등 다른 탭에서 문서를 열어도
// 탭 이동 없이 그 자리에서 팝업이 뜨도록 selectedDocId 기준으로 항상 마운트됨
// (2026-08-23(2)).
import DeptFilterSelect from "./DeptFilterSelect.jsx";
import { mockSummarize, fetchPersOfrdDeptList } from "../lib/kisApi.js";
import { isWithinRecentDays, RECENT_DOCS_DAYS } from "../lib/textUtils.js";

// 2026-09-07(5): 예전 CalendarPage.jsx에 있던 날짜 유틸 그대로 가져옴(날짜
// 선택 기능 복원용).
function toDateStr(year, month, day) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}
function todayStr() {
  const now = new Date();
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
}

// 2026-09-07(10): "카드가 눈에 안 들어온다"는 리포트로 여러 리스트형 시안을
// 보여드렸는데, 최종적으로는 "디자인/구성은 기존 카드(CoopCard.jsx) 그대로
// 쓰고, 배치만 1열 리스트로" 요청받음 — 카드 컴포넌트 자체는 전혀 안 건드리고
// (헤더/AI Summary 배너/배지 등 지금 디자인 그대로), 감싸는 그리드만 2열→1열
// 리스트로 바꿔서 카드 폭을 넓혀 가독성을 높임. 1열이라 세로로 더 길어지는
// 만큼 페이지당 개수도 8(2×4)에서 5로 줄임.
const PAGE_SIZE = 5;
// 2026-08-22(10): 페이지 번호 버튼을 한 번에 4개씩만 보여주고(1~4, 5~8, ...),
// 그 범위를 벗어나면 화살표로 다음/이전 묶음으로 넘어가게. 화살표는 그냥
// 페이지를 1씩 옮길 뿐인데, 4페이지 창(윈도우)이 "현재 페이지가 속한 4개
// 묶음"을 기준으로 계산되니까 4→5로 넘어가는 순간 자동으로 5~8 묶음으로
// 바뀜(화살표 로직을 따로 안 바꿔도 됨).
const PAGE_WINDOW = 4;

export default function CoopPage() {
  const allCoopDocs = useStore((s) => s.coopDocs);
  const loadCoopDocs = useStore((s) => s.loadCoopDocs);
  const openDetail = useStore((s) => s.openDetail);
  const selectedDeptGroupKey = useStore((s) => s.selectedDeptGroupKey);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  // 2026-08-23(14): 아래 availableDepts 참고 — ERP "findPersOfordDeptList.do"
  // (내 소속 부서 전체) 응답을 담아둠. 문서 유무와 무관하게 항상 ERP
  // 드롭다운과 똑같은 부서 목록을 보여주기 위한 보조 상태.
  const [myDeptNames, setMyDeptNames] = useState([]);

  useEffect(() => {
    loadCoopDocs();
  }, [loadCoopDocs]);

  // 2026-09-07: "최근 한 달치만 불러오도록" — 표시용 목록을 기안일(date)
  // 기준 최근 30일로 한 번 걸러낸다. 부서 필터 드롭다운(availableDepts)도
  // 이 최근 목록 기준으로 만들어서, 지금은 문서가 없는(1개월 밖으로 밀려난)
  // 부서까지 드롭다운에 남지 않게 한다(단, myDeptNames로 ERP 공식 부서 목록은
  // 여전히 항상 합쳐지므로 소속 부서 자체가 사라지진 않는다).
  const recentDocs = useMemo(
    () => allCoopDocs.filter((d) => isWithinRecentDays(d.date, RECENT_DOCS_DAYS)),
    [allCoopDocs]
  );

  // 2026-08-23(14): Claude in Chrome으로 실제 로그인된 kis.kbu.ac.kr 세션에
  // 직접 들어가 협조문수신함 화면의 부서 드롭다운을 열어 실측한 결과, ERP는
  // 이 계정 기준 정확히 6개 부서를 돌려준다(혁신지원사업단/디지털트윈연구원
  // ×2(코드는 다르고 이름만 같음)/AI디지털트윈 연구원(공백 있음)/빅데이터과/
  // 소프트웨어융합과). 그런데 kisApi.js의 persOfrdDeptList 엔드포인트 경로가
  // "findPersOfrdDeptList.do"로 오타 나 있어서(실제로는 findPersOford
  // DeptList.do, o가 하나 더 있음) 이 API 호출이 매번 조용히 실패하고
  // 있었음 — 그래서 예전 로직(아래 커밋했던 "문서에 실제로 있던
  // recv_dept_name만 모으기")은 근본적으로 이 API를 못 쓰는 상태에서 나온
  // 임시방편이었고, 그 결과 문서 이력이 없는 부서는 드롭다운에서 계속
  // 빠졌던 것("부서가 2개만 뜬다" 리포트의 진짜 원인). kisApi.js 경로 오타를
  // 고쳤으니 이제 이 API를 직접 불러서 드롭다운을 채운다 — 문서가 하나도
  // 없는 부서까지 포함해서 항상 ERP와 동일한 전체 목록이 보이게 함. 이
  // 조회 자체가 실패해도(일시적 네트워크 문제 등) 아래 useMemo가 기존처럼
  // coopDocs 쪽 이름과 합쳐서 보여주므로 화면이 깨지진 않는다.
  useEffect(() => {
    fetchPersOfrdDeptList()
      .then((depts) => setMyDeptNames(depts.map((d) => d.name).filter(Boolean)))
      .catch((err) => console.warn("[CoopPage] 소속 부서 목록(findPersOfordDeptList) 조회 실패 — 문서 기반 목록만 사용:", err));
  }, []);

  // 2026-08-22(14): DEPT_GROUPS(우진 개인 조직도를 손으로 묶어둔 목록) 제거 —
  // 다른 부서 사람에게 배포하면 그 하드코딩된 묶음이 안 맞아서 필터가
  // 무의미해지는 문제가 있었음. "혁신지원사업단 선택하면 하위조직인
  // 디지털트윈연구원 문서도 같이 보임" 같은 특수 묶음 편의는 없음(그
  // 부서명 그대로 하나씩 선택). 전체(null)면 안 거르고 다 보여줌.
  //
  // ⚠️ 2026-08-23(12): "부서가 6개여야 하는데 몇 개만 뜬다"는 리포트로 공백만
  // 무시하고 합치는 정규화를 한 번 넣었었는데, 확인해보니 틀린 추정이었음 —
  // "AI디지털트윈 연구원"(공백 있음, 기획처 소속)과 "AI디지털트윈연구원"(공백
  // 없음)은 실제로 서로 다른 부서다(우진 확인). 그래서 정규화를 되돌리고
  // recv_dept_name을 다시 그대로(공백 포함 원문 그대로) 비교/표시한다.
  //
  // 2026-08-23(14): 위 myDeptNames(ERP 공식 부서 목록)와 문서에서 뽑은 이름을
  // 합쳐서 보여준다 — ERP 목록 조회가 실패해도 문서 기반 이름은 그대로
  // 남고, 문서가 아직 하나도 없는 부서도 ERP 목록 쪽에서 채워진다.
  const availableDepts = useMemo(
    () =>
      [...new Set([...myDeptNames, ...recentDocs.map((d) => d.recv_dept_name).filter(Boolean)])].sort(),
    [recentDocs, myDeptNames]
  );
  const deptFilteredDocs = selectedDeptGroupKey
    ? recentDocs.filter((d) => d.recv_dept_name === selectedDeptGroupKey)
    : recentDocs;
  const scopedDocs = deptFilteredDocs;

  // 2026-08-22(6): 검색창 — 버튼 없이 입력하는 즉시(onChange) 필터링. 제목/
  // 발신부서/수신부서/기안자/AI요약(또는 mockSummarize 대체 요약) 전부 대상으로
  // 부분 일치 검색.
  // 2026-08-22(9): "행정업무"로 검색해도 문서 안의 "행정 업무"(띄어쓰기 있는
  // 형태)가 걸리게 — 검색어/본문 양쪽 공백을 다 제거하고 비교. 반대로
  // "행정 업무"라고 띄어서 검색해도 붙여쓴 "행정업무"가 걸림(양쪽 다 공백을
  // 지우고 비교하니까 대칭적으로 동작).
  const query = searchText.replace(/\s+/g, "").toLowerCase();
  const visibleDocs = useMemo(() => {
    if (!query) return scopedDocs;
    return scopedDocs.filter((d) => {
      const haystack = [
        d.title,
        d.sender_dept,
        d.recv_dept_name,
        d.drafter,
        d.ai_summary || mockSummarize(d),
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, "")
        .toLowerCase();
      return haystack.includes(query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedDocs, query]);

  // 검색어/부서 필터가 바뀌면 1페이지로 리셋 (안 그러면 결과가 줄었는데
  // 예전 페이지 번호에 그대로 머물러 빈 화면이 뜰 수 있음).
  useEffect(() => {
    setPage(1);
  }, [query, selectedDeptGroupKey]);

  const totalPages = Math.max(1, Math.ceil(visibleDocs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const windowStart = Math.floor((safePage - 1) / PAGE_WINDOW) * PAGE_WINDOW + 1;
  const windowEnd = Math.min(windowStart + PAGE_WINDOW - 1, totalPages);
  const pageDocs = visibleDocs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 2026-09-07: 캘린더 블록(예전 CalendarPage.jsx)에서 그대로 가져온 월 이동
  // 상태.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
  });
  const goPrevMonth = () =>
    setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }));
  const goNextMonth = () =>
    setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }));
  const goToday = () => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(todayStr());
  };

  // 2026-09-07(5): 되살린 날짜 선택 — 캘린더에서 날짜를 누르면 그 날짜가
  // 마감인 협조문만 아래에 짧게 보여준다(투두 없이, recentDocs의 deadline
  // 기준). 상세는 기존 openDetail로 그대로 연결.
  const [selectedDate, setSelectedDate] = useState(() => todayStr());
  const selectedDateLabel = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString("ko-KR", {
        month: "long",
        day: "numeric",
        weekday: "short",
      })
    : "";
  const selectedDateDocs = useMemo(
    () => recentDocs.filter((d) => d.deadline === selectedDate),
    [recentDocs, selectedDate]
  );

  let emptyMessage = "이 부서에 해당하는 협조문이 없습니다.";
  if (allCoopDocs.length === 0) {
    emptyMessage = "아직 수신된 협조문이 없습니다.";
  } else if (recentDocs.length === 0) {
    emptyMessage = `최근 ${RECENT_DOCS_DAYS}일 이내 수신된 협조문이 없습니다.`;
  }

  return (
    <div className="p-4 max-w-7xl mx-auto">
      {/* 2026-09-07(4): "검색/부서 드롭다운을 제목 밑으로 넣어줘" 요청 — 예전엔
          제목(왼쪽)과 검색/필터(오른쪽 끝)가 같은 높이 라인 위에 있어서 구조상
          아래 줄이어도 시각적으로는 "제목 옆"처럼 보였다. 제목 아래에 왼쪽
          정렬로 확실히 붙여서(mt-3, justify-start) 소제목처럼 읽히게 함. */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-brand-navy">협조문수신함</h2>
      </div>

      {/* 2026-09-07(7): "달력이랑 처리해야할일 너비 좀더 넓혀줘" 요청 — 카드
          열 7 : 달력/할일 열 5였던 비율을 6:6으로 조정해서 오른쪽(달력+처리
          해야 할 일) 폭을 넓힘. 카드는 sm 이상이면 이미 2열이라 6/12로
          좁아져도 레이아웃이 깨지지 않는다. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* 협조문 카드 2열 */}
        <div className="xl:col-span-6">
          {/* 2026-09-07(6): "검색창을 협조문 카드 길이랑 맞춰줘" 요청 — 검색/
              부서 필터 줄을 카드 영역(xl:col-span-6) 안으로 옮기고, 검색창은
              flex-1로 남는 폭을 다 채우게 해서 카드 2열 폭과 자연스럽게
              맞춰짐(전체 페이지 폭이 아니라 카드 열 폭 기준). */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="제목, 부서, 내용으로 검색"
              className="border border-brand-border rounded-md px-3 py-1.5 text-sm bg-white flex-1 min-w-[180px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <DeptFilterSelect options={availableDepts} />
          </div>
          {/* 2026-09-07(10): "디자인/구성은 기존 카드 활용" 요청 — CoopCard.jsx는
              그대로 두고, 감싸는 컨테이너만 2열 그리드에서 1열 리스트(세로
              flex)로 바꿈. 카드 폭이 넓어져서 제목/AI요약이 덜 답답해 보임. */}
          {visibleDocs.length === 0 ? (
            <p className="text-brand-muted text-sm">{emptyMessage}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {pageDocs.map((doc) => (
                <CoopCard key={doc.id} doc={doc} onClick={() => openDetail(doc.id)} forceExpanded />
              ))}
            </div>
          )}
          {/* 2026-08-22(7): "12개 있어도 페이지가 안 넘어간다" 리포트 대응 —
              totalPages가 1이어도(=문서 개수가 적음) 페이지네이션 자체는 항상
              그려서 "왜 안 넘어가는지"(페이지가 1개뿐이라 넘어갈 데가 없는 건지,
              진짜 버그인지)를 눈으로 바로 확인할 수 있게 함. 스타일은 숫자 버튼형
              (B안)으로 변경. */}
          {visibleDocs.length > 0 && (
            <div className="flex items-center justify-center gap-1.5 mt-6">
              {/* 2026-08-22(11): 한 페이지씩 넘기는 ‹/›와 별개로, 묶음(4페이지)
                  단위로 한 번에 넘기는 «/» 추가. windowStart가 이미 1묶음째면
                  «는 비활성화, 다음 묶음이 없으면(windowStart + PAGE_WINDOW가
                  totalPages를 넘으면) »도 비활성화. */}
              <button
                onClick={() => setPage(Math.max(1, windowStart - PAGE_WINDOW))}
                disabled={windowStart === 1}
                aria-label="이전 페이지 묶음"
                className="w-7 h-7 flex items-center justify-center rounded-md border border-brand-border text-brand-muted disabled:opacity-30 disabled:cursor-default hover:bg-brand-alt"
              >
                «
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                aria-label="이전 페이지"
                className="w-7 h-7 flex items-center justify-center rounded-md border border-brand-border text-brand-muted disabled:opacity-30 disabled:cursor-default hover:bg-brand-alt"
              >
                ‹
              </button>
              {Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i).map((n) => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={
                    n === safePage
                      ? "w-7 h-7 flex items-center justify-center rounded-md text-sm font-medium bg-brand-blue text-white"
                      : "w-7 h-7 flex items-center justify-center rounded-md text-sm text-brand-muted border border-brand-border hover:bg-brand-alt"
                  }
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                aria-label="다음 페이지"
                className="w-7 h-7 flex items-center justify-center rounded-md border border-brand-border text-brand-muted disabled:opacity-30 disabled:cursor-default hover:bg-brand-alt"
              >
                ›
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages, windowStart + PAGE_WINDOW))}
                disabled={windowStart + PAGE_WINDOW > totalPages}
                aria-label="다음 페이지 묶음"
                className="w-7 h-7 flex items-center justify-center rounded-md border border-brand-border text-brand-muted disabled:opacity-30 disabled:cursor-default hover:bg-brand-alt"
              >
                »
              </button>
            </div>
          )}
        </div>

        {/* 캘린더 + 처리해야 할 일 (2026-09-07: 캘린더 탭 흡수) */}
        <div className="xl:col-span-6 flex flex-col gap-5">
          <div className="bg-white rounded-2xl p-5 shadow-brand border border-brand-border/60">
            <div className="flex items-center justify-between mb-4">
              <button onClick={goPrevMonth} className="px-2 text-brand-muted hover:text-brand-navy" aria-label="이전 달">
                ←
              </button>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold text-brand-navy">{monthLabel}</h2>
                <button
                  onClick={goToday}
                  className="text-[11px] text-brand-muted border border-brand-border rounded-md px-1.5 py-0.5 hover:bg-brand-alt hover:text-brand-navy"
                >
                  오늘
                </button>
              </div>
              <button onClick={goNextMonth} className="px-2 text-brand-muted hover:text-brand-navy" aria-label="다음 달">
                →
              </button>
            </div>
            <CalendarGrid
              docs={recentDocs}
              year={cursor.year}
              month={cursor.month}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            <p className="text-[11px] text-brand-muted flex items-center gap-1.5 mt-3">
              {/* 2026-09-07(9): "달력에 도트 표시 안된다" — 존재하지 않는
                  "bg-brand-alt0" 오타 클래스가 원인이었음(CalendarGrid.jsx
                  참고). 범례도 실제 dot과 같은 색(brand-blue)으로 맞춤. */}
              <span className="w-1.5 h-1.5 rounded-full bg-brand-blue inline-block" /> 협조문 마감
            </p>
            {/* 2026-09-07(5): 선택된 날짜가 마감인 협조문을 보여줌 — 새 데이터는
                아니고 기존 recentDocs의 deadline을 그대로 재사용.
                2026-09-07(8): "잘려보일 땐 내용 전부 보이게(줄바꿈 해서라도)"
                요청 — truncate(말줄임표) 대신 break-words로 줄바꿈해서 제목이
                항상 끝까지 다 보이게 함. */}
            <div className="mt-3 pt-3 border-t border-brand-border/60">
              <p className="text-[11.5px] text-brand-muted mb-1.5">{selectedDateLabel} 선택됨</p>
              {selectedDateDocs.length === 0 ? (
                <p className="text-[11.5px] text-brand-muted">이 날짜가 마감인 협조문이 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {selectedDateDocs.map((doc) => (
                    <li key={doc.id}>
                      <button
                        onClick={() => openDetail(doc.id)}
                        className="text-[12px] text-brand-navy hover:text-brand-blue text-left break-words w-full leading-[1.4]"
                      >
                        {doc.title || "(제목 없음)"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <TaskPanel docs={recentDocs} />
        </div>
      </div>
    </div>
  );
}
