// src/components/CoopPage.jsx
// 협조문 탭 전체.

import { useEffect, useMemo, useState } from "react";
import useStore from "../store/useStore.js";
import CoopTimelineItem from "./CoopTimelineItem.jsx";
// CoopDetailModal은 App.jsx로 옮김 — 브리핑 탭 등 다른 탭에서 문서를 열어도
// 탭 이동 없이 그 자리에서 팝업이 뜨도록 selectedDocId 기준으로 항상 마운트됨
// (2026-08-23(2)).
import DeptFilterSelect from "./DeptFilterSelect.jsx";
import { mockSummarize, fetchPersOfrdDeptList } from "../lib/kisApi.js";

// 2026-09-02: "신규"는 이번 달(달력 기준 1일~말일)에 온 문서만 뜨는 걸로
// 확정 — 그 전엔 "최근 30일" 식으로 매일 굴러가는 창(rolling window)을
// 썼는데, 이러면 예를 들어 오늘이 9/2일 때 8/5에 온 문서도 "최근 30일 이내"
// 라서 신규로 잡혀버리는 등 "이번 달"이라는 말과 실제 동작이 달랐다. 이제는
// 문서의 기안일(date)이 오늘과 같은 연/월이면만 신규로 본다.
// ⚠️ 2026-09-02 버그 수정도 같이 반영: 결재 경유가 길어서 기안일 자체는
// 지난달 이전인데 이 앱엔 방금 막(is_new:true) 처음 들어온 문서가 "신규"
// 표시 없이 곧장 이미 열람한 것처럼 보이는 문제가 있었다 — 한 번도 안 읽은
// 문서(is_new)는 기안월과 무관하게 항상 신규로 취급한다.
function isRecentDoc(doc) {
  // 2026-09-02(2): "신규는 이번 달 것만"이라는 요구를 is_new(읽음 여부) 예외로
  // 어겼던 회귀 수정. 이전 시도는 "결재 경유가 길어서 기안일은 지난달인데 방금
  // 막 들어온 문서"를 구제하려고 doc.is_new(한 번도 안 읽음)면 무조건 신규로
  // 봤는데, is_new는 "사용자가 아직 열어본 적 없다"는 뜻일 뿐 "최근에 왔다"는
  // 뜻이 아니라서, 몇 달 전에 들어왔지만 굳이 클릭 안 하고 넘어간 공지성
  // 문서까지 전부 계속 "신규"로 남는 문제가 있었다(원래 리포트가 바로 이
  // 증상). 대신 이 앱이 그 문서를 실제로 처음 저장한 시점(created_at, 폴링
  // 때마다 자동 기록됨)이 이번 달인지로 판단한다 — "결재 경유가 길어 기안일
  // 자체는 지난달인데 이번 달에 처음 이 앱에 잡힌 문서"는 여전히 신규로
  // 뜨고, "그냥 몇 달 전에 들어왔는데 안 열어본 문서"는 더 이상 신규로 안
  // 뜬다.
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

// 3열 × 4줄 = 12개씩 페이지네이션.
const PAGE_SIZE = 12;
// 2026-08-22(10): 페이지 번호 버튼을 한 번에 4개씩만 보여주고(1~4, 5~8, ...),
// 그 범위를 벗어나면 화살표로 다음/이전 묶음으로 넘어가게. 화살표는 그냥
// 페이지를 1씩 옮길 뿐인데, 4페이지 창(윈도우)이 "현재 페이지가 속한 4개
// 묶음"을 기준으로 계산되니까 4→5로 넘어가는 순간 자동으로 5~8 묶음으로
// 바뀜(화살표 로직을 따로 안 바꿔도 됨).
const PAGE_WINDOW = 4;

export default function CoopPage() {
  const coopDocs = useStore((s) => s.coopDocs);
  const loadCoopDocs = useStore((s) => s.loadCoopDocs);
  const openDetail = useStore((s) => s.openDetail);
  const selectedDeptGroupKey = useStore((s) => s.selectedDeptGroupKey);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  // 2026-08-23(4): "신규/전체를 클릭 필터로" 요청 — 한 화면에 신규/처리완료를
  // 다 늘어놓는 대신 탭처럼 눌러서 거른다. "전체"를 눌러도 NEW 배지는 카드에
  // 그대로 남아있음(is_new 값 자체를 안 건드리고 목록만 거르는 거라).
  // 2026-08-23(11): "협조문 탭 처음 누르면 신규가 기본값" 요청 — 처음 진입 시
  // "신규"가 먼저 보이게 초기값을 바꿈("전체"를 눌러도 NEW 배지 자체는 그대로
  // 남아있는 동작은 그대로 유지).
  const [newFilter, setNewFilter] = useState("new"); // "all" | "new"
  // 2026-08-23(14): 아래 availableDepts 참고 — ERP "findPersOfordDeptList.do"
  // (내 소속 부서 전체) 응답을 담아둠. 문서 유무와 무관하게 항상 ERP
  // 드롭다운과 똑같은 부서 목록을 보여주기 위한 보조 상태.
  const [myDeptNames, setMyDeptNames] = useState([]);

  useEffect(() => {
    loadCoopDocs();
  }, [loadCoopDocs]);

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
      [...new Set([...myDeptNames, ...coopDocs.map((d) => d.recv_dept_name).filter(Boolean)])].sort(),
    [coopDocs, myDeptNames]
  );
  const deptFilteredDocs = selectedDeptGroupKey
    ? coopDocs.filter((d) => d.recv_dept_name === selectedDeptGroupKey)
    : coopDocs;
  const newCount = coopDocs.filter(isRecentDoc).length;
  const scopedDocs = newFilter === "new" ? deptFilteredDocs.filter(isRecentDoc) : deptFilteredDocs;

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

  // 검색어/부서 필터/신규 필터가 바뀌면 1페이지로 리셋 (안 그러면 결과가
  // 줄었는데 예전 페이지 번호에 그대로 머물러 빈 화면이 뜰 수 있음).
  useEffect(() => {
    setPage(1);
  }, [query, selectedDeptGroupKey, newFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleDocs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const windowStart = Math.floor((safePage - 1) / PAGE_WINDOW) * PAGE_WINDOW + 1;
  const windowEnd = Math.min(windowStart + PAGE_WINDOW - 1, totalPages);
  const pageDocs = visibleDocs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-semibold text-brand-navy shrink-0">협조문수신함</h2>
        <div className="flex items-center gap-1 bg-brand-alt rounded-lg p-0.5">
          <button
            onClick={() => setNewFilter("new")}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
              newFilter === "new" ? "bg-white text-brand-blue shadow-sm" : "text-brand-muted hover:text-brand-navy"
            }`}
          >
            신규{newCount > 0 && ` ${newCount}`}
          </button>
          <button
            onClick={() => setNewFilter("all")}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
              newFilter === "all" ? "bg-white text-brand-blue shadow-sm" : "text-brand-muted hover:text-brand-navy"
            }`}
          >
            전체
          </button>
        </div>
      </div>
      <div className="flex items-center justify-end mb-4 gap-3">
        <div className="flex items-center gap-3 flex-1 justify-end">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="제목, 부서, 내용으로 검색"
            className="border border-brand-border rounded-md px-3 py-1.5 text-sm bg-white w-full max-w-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <DeptFilterSelect options={availableDepts} />
        </div>
      </div>
      {visibleDocs.length === 0 ? (
        <p className="text-brand-muted text-sm">
          {coopDocs.length === 0
            ? "아직 수신된 협조문이 없습니다."
            : newFilter === "new"
            ? "새로 온 협조문이 없습니다."
            : "이 부서에 해당하는 협조문이 없습니다."}
        </p>
      ) : (
        // 2026-09-05: "타임라인형으로 가보자" 요청 — 그리드 카드 대신 접수일
        // 순서를 세로선으로 이어서 보여주는 CoopTimelineItem으로 교체
        // (preview_layout_styles.html ④안 채택). max-w로 폭을 좁혀서 타임라인
        // 한 줄이 너무 길게 늘어나지 않게 함. isLast만 넘겨서 마지막 항목
        // 아래로는 연결선이 허공에 뜨지 않게 함.
        <div className="max-w-2xl mx-auto">
          {pageDocs.map((doc, idx) => (
            <CoopTimelineItem
              key={doc.id}
              doc={doc}
              onClick={() => openDetail(doc.id)}
              // 2026-08-23(16): "신규탭에서는 펼쳐지게 하고 전체에서는 다
              // 닫아버려" 요청 — 카드 개별 토글 없이, 지금 보고 있는 탭
              // (newFilter)에 따라 AI요약 펼침 여부를 일괄로 정함.
              expanded={newFilter === "new"}
              isLast={idx === pageDocs.length - 1}
            />
          ))}
        </div>
      )}
      {/* 2026-08-22(7): "12개 있어도 페이지가 안 넘어간다" 리포트 대응 —
          totalPages가 1이어도(=문서 12개 이하) 페이지네이션 자체는 항상
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
  );
}
