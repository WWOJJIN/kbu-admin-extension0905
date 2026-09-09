// src/components/ApprovalStatusPage.jsx
// 결재 현황 탭 — 지출/출장결재현황 + 내부기안결재현황 통합 화면.
// 2026-08-23(4) 신규 추가.
//
// ⚠️ 중요한 한계 (2026-08-23(9) 기준):
// 1. ENDPOINTS.expenseTravelList/internalDraftList의 menuId/pgmId는 프로토타입
//    실측값으로 채워져서 더 이상 TODO 상태가 아니다(kisApi.js 참고) — 실제로
//    177건(지출/출장 84 + 내부기안 93) 데이터가 정상적으로 오는 것까지 확인됨.
// 2. stGbn/lastStGbn/workStgCd이 정확히 어떤 값일 때 "미결재"인지는 아직
//    완전히 실측 확인이 안 됐다(협조문의 stGbn과 마찬가지로 검증 안 된 원시
//    코드값). "02"="진행(결재 대기중)"만 kisApi.js의 aprvMngList 실사용으로
//    확인됐고, 나머지(00/01/03/04/05)는 지침 문서의 상태값 목록(전체/대기/
//    진행/완료/반려/결재취소) 순서를 근거로 한 추정치다(아래 STATUS_LABELS).
//    그래서 라벨을 원본 코드로 완전히 대체하지 않고 "라벨 (코드)" 형태로
//    같이 보여준다 — 실제 ERP 화면과 대조해서 틀린 게 있으면 알려주면 고칠 것.
import { useEffect, useMemo, useState } from "react";
import { fetchExpenseTravelList, fetchInternalDraftList } from "../lib/kisApi.js";

// 2026-09-07: "결재현황도 한 달치만 나오게" 요청 — ERP가 돌려주는 draftDt/
// aprvDttm은 "YYYYMMDDHHmmssSSS"(17자리) 원본 숫자 문자열이라(위 formatDateTime
// 참고), textUtils.js의 isWithinRecentDays(YYYY-MM-DD 전용)를 그대로 못 써서
// 이 화면 전용으로 raw 날짜 문자열을 바로 받는 버전을 따로 둔다.
const RECENT_APPROVAL_DAYS = 30;
function isRecentRawDate(raw, days = RECENT_APPROVAL_DAYS) {
  if (!raw) return false;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8) return false;
  const target = new Date(
    Number(digits.slice(0, 4)),
    Number(digits.slice(4, 6)) - 1,
    Number(digits.slice(6, 8))
  );
  if (Number.isNaN(target.getTime())) return false;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayMid.getTime() - target.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays <= days;
}

const TABS = [
  { key: "all", label: "전체" },
  { key: "expense", label: "지출/출장" },
  { key: "internal", label: "내부기안" },
];

// ERP 날짜 필드(draftDt/aprvDttm)는 "YYYYMMDDHHmmssSSS"(17자리) 형태의 숫자
// 문자열로 온다(background.js의 normalizeDocDate와 동일한 포맷 — 2026-08-23(9)
// 확인: 화면에 "20260821155123000"처럼 raw 값이 그대로 노출되던 버그가 있었음,
// 표시용으로 사람이 읽을 수 있게 잘라서 보여준다. 정렬은 이 raw 숫자 문자열
// (sortKey)로 하는 게 안전 — 앞자리부터 연/월/일/시/분/초 순서라 문자열
// 비교만으로도 시간순 정렬이 그대로 맞는다. 8자리(날짜만)만 오는 경우도
// 방어적으로 처리.
function formatDateTime(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8) return String(raw); // 예상 밖 포맷은 원본 그대로(자르다 깨지는 것보다 안전)
  const datePart = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length >= 12) {
    return `${datePart} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  return datePart;
}

// ⚠️ stGbn 코드값 → 사람이 읽는 라벨. "02"=진행(aprvMngList 실사용 근거)에 이어
// 2026-08-23(10): 실제 화면에서 "01"=대기, "03"=완료도 육안 확인 완료(우진 확인).
// 나머지(00/04/05)는 지침 문서의 상태값 목록(전체/대기/진행/완료/반려/결재취소)
// 순서를 근거로 한 추정치라 아직 다를 수 있다. "라벨 (코드)" 형태로 원본 코드를
// 같이 보여줘서, 틀린 게 있으면 바로 눈에 띄게 해둠.
const STATUS_LABELS = {
  "00": "전체",
  "01": "대기", // 실측 확인됨
  "02": "진행", // 실측 확인됨 (aprvMngList stGbn="02" 사용 근거)
  "03": "완료", // 실측 확인됨
  "04": "반려",
  "05": "결재취소",
};

function formatStatusCode(code) {
  if (!code) return "-";
  const label = STATUS_LABELS[code];
  return label ? `${label} (${code})` : code;
}

// 2026-09-08: "학적변동/협조문 탭이랑 통일성 있게, 상태는 완료(회색)·반려
// (빨간색)·진행중(노란색) 3종으로" 요청 — 기존 5개 코드(00~05) 기반 라벨을
// 화면에 그대로 노출하던 것(예: "완료 (03)")을 3버킷으로 묶어서 단순화했다.
// "대기"(01)는 실사용 중 실제로 관측된 적이 거의 없다는 우진 피드백에 따라
// 별도 버킷을 안 두고 진행중에 합침 — 원본 코드값은 카드/리스트에서
// title(hover) 속성으로 formatStatusCode(item.status)를 그대로 남겨둬서,
// 나중에 코드값 추정이 틀린 게 발견되면 바로 확인할 수 있게 했다.
const BUCKET_META = {
  progress: { label: "진행중", badge: "bg-status-amberBg text-status-amber" },
  done: { label: "완료", badge: "bg-slate-100 text-brand-muted" },
  rejected: { label: "반려", badge: "bg-status-redBg text-status-red" },
};

function statusBucket(code) {
  if (code === "03") return "done";
  if (code === "04" || code === "05") return "rejected";
  return "progress"; // 00/01/02 + 미확인 코드 전부 진행중으로 취급
}

// 2026-09-08: "반려·완료된 카드는 전체를 중립톤으로" 요청 — 아래
// ApprovalCard 개별 카드에서만 쓰는 무채색 배지. 요약 패널(KPI 타일/최근
// 상태 변경 목록)은 "전체 통계"라 원래 색(BUCKET_META)을 그대로 유지하고,
// 여기서 "카드"란 리스트에 나열되는 개별 문서 카드만 가리킨다.
const FINISHED_BADGE = {
  done: "bg-[#E9EBF2] text-brand-muted",
  rejected: "bg-[#F3E4E4] text-[#B36569]",
};

// 지출/출장 vs 내부기안 구분 태그 — 학적변동 SummaryPanel의 보조 액센트
// (status-violet)를 내부기안 쪽에 그대로 가져와서 "이 앱은 파란색=지출/출장,
// 보라색=내부기안"이라는 감각을 다른 탭과 통일했다.
function typeTagClass(it) {
  return it.source === "expense" ? "bg-brand-alt text-brand-blueDark" : "bg-status-violetBg text-status-violet";
}
function typeLabel(it) {
  return it.source === "expense" ? "지출/출장" : it.docDivNm || "내부기안";
}

/**
 * 카드 하단에 보여줄 "누가/어느 단계인지" 한 줄.
 * 2026-08-26 정정 사실은 그대로 유지: lastAprvUser는 "현재 결재중인 사람"이
 * 아니라 "마지막으로 이미 처리를 완료한 사람"이다. 그래서 진행중이고
 * aprvLevel(ERP가 이미 "김양진 결재중"처럼 완성해서 내려주는 문자열)이 있으면
 * 그걸 우선 쓰고, 없으면 "최근 처리자: 이름"으로 — "결재중"이라는 오해를
 * 주는 조합은 하지 않는다.
 */
function whoLine(item, bucket) {
  if (bucket === "progress" && item.aprvLevel) return `현재 단계: ${item.aprvLevel}`;
  if (item.lastAprvUser) return `최근 처리자: ${item.lastAprvUser}`;
  return "-";
}

function normalizeExpenseItem(row) {
  const rawDate = row.draftDt || row.aprvDttm || "";
  return {
    source: "expense",
    id: row.aprvNo,
    subject: row.subject || "(제목 없음)",
    deptNm: row.deptNm || "",
    date: formatDateTime(rawDate),
    sortKey: rawDate,
    status: row.stGbn || row.lastStGbn || "",
    aprvLevel: row.aprvLevel || "",
    lastAprvUser: row.lastAprvUser || "",
  };
}

function normalizeInternalItem(row) {
  const rawDate = row.draftDt || "";
  return {
    source: "internal",
    id: row.aprvNo,
    subject: row.subject || "(제목 없음)",
    deptNm: row.deptNm || "",
    date: formatDateTime(rawDate),
    sortKey: rawDate,
    status: row.stGbn || row.lastStGbn || row.workStgCd || "",
    aprvLevel: row.aprvLevel || "",
    lastAprvUser: row.lastAprvUser || "",
    // 2026-08-26 추가 — 실측 확인: findIntAprvDraftList.do 응답이 내부결재
    // (docDivCd="10")와 대내결재/협조문(docDivCd="20", docDivNm은
    // "대내결재(협조문)"으로 옴)을 섞어서 반환한다. 지금까지는 이 필드를
    // 아예 안 읽어서 화면에 전부 "내부기안"으로 뭉뚱그려 보였음 — 실제
    // 93건 중 22건 내부결재/71건 협조문으로 실측 확인.
    docDivNm: row.docDivNm || "",
    docDivCd: row.docDivCd || "",
  };
}

// 최신순 정렬. sortKey(raw YYYYMMDDHHmmssSSS 문자열)로 비교 — 문자열째로
// 비교해도 자리수가 같으면 시간순과 일치한다.
function sortByDateDesc(a, b) {
  return (b.sortKey || "").localeCompare(a.sortKey || "");
}

// 2026-09-08: "학적변동/협조문 탭이랑 통일성 있게" 요청으로 새로 만든 좌측
// 요약 패널 — StatusChangePage.jsx의 SummaryPanel과 같은 뼈대(둥근 흰
// 카드 + 아이콘/제목 + "실시간" 배지 + brand-alt 배경 KPI 2x2 타일)를
// 그대로 가져왔다.
// ⚠️ "최근 상태 변경" 목록의 한계: 학적변동은 background.js 폴링이 상태가
// 바뀐 시점을 알고 있어서 진짜 "변경 이력"을 보여줄 수 있지만, 이 화면은
// 탭을 열 때마다 ERP 목록을 그대로 fetch할 뿐 "언제 바뀌었는지"를 저장해두는
// 구조가 아니다. 그래서 여기 보이는 건 실제로 상태가 "방금 바뀐" 건이 아니라
// 문서 날짜(sortKey) 기준 최신 5건이다 — 진짜 변경 이력을 원하면 background.js
// 결재현황 폴링에도 학적변동의 resolved_at처럼 "마지막 상태 변경 시각"을
// 저장하고 이 화면이 그 데이터(IndexedDB)를 읽도록 바꿔야 한다(별도 작업).
function ApprovalSummaryPanel({ items }) {
  const counts = useMemo(() => {
    const c = { progress: 0, done: 0, rejected: 0 };
    for (const it of items) c[statusBucket(it.status)] += 1;
    return c;
  }, [items]);

  const recent = useMemo(() => [...items].sort(sortByDateDesc).slice(0, 5), [items]);

  return (
    <div className="bg-white rounded-[20px] border border-brand-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-extrabold text-brand-navy flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-lg bg-slate-100 text-brand-blue flex items-center justify-center flex-shrink-0 text-[13px]">
            📋
          </span>
          결재 현황 요약
        </h3>
        <span className="text-[10.5px] font-bold text-status-green bg-status-greenBg px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse" /> 실시간
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-brand-alt rounded-xl px-3 py-2.5">
          <p className="text-[10.5px] text-brand-muted font-semibold">전체 건수</p>
          <div className="mt-1">
            <span className="text-xl font-bold text-brand-navy">{items.length}</span>
          </div>
        </div>
        {(["progress", "done", "rejected"]).map((bucket) => (
          <div key={bucket} className="bg-brand-alt rounded-xl px-3 py-2.5">
            <p className="text-[10.5px] text-brand-muted font-semibold">{BUCKET_META[bucket].label}</p>
            <div className="flex items-baseline justify-between gap-1.5 mt-1">
              <span className="text-xl font-bold text-brand-navy">{counts[bucket]}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${BUCKET_META[bucket].badge}`}>
                {BUCKET_META[bucket].label}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[12px] text-brand-muted font-semibold mb-2 flex items-center gap-1.5">🕓 최근 상태 변경</p>
        {recent.length === 0 ? (
          <p className="text-[12px] text-brand-muted">데이터 없음</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((it) => {
              const bucket = statusBucket(it.status);
              return (
                <li
                  key={`${it.source}-${it.id}`}
                  className="flex items-center gap-2 py-1.5 border-b border-brand-border last:border-b-0 last:pb-0"
                >
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${BUCKET_META[bucket].badge}`}>
                    {BUCKET_META[bucket].label}
                  </span>
                  <span className="text-[12px] font-semibold text-brand-navy flex-1 truncate">{it.subject}</span>
                  <span className="text-[10.5px] text-brand-muted flex-shrink-0">{it.date}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// 2026-09-08: 학적변동/협조문 카드와 같은 뼈대(흰 배경, 얇은 테두리, 상단
// 태그 스트립, 제목은 안 잘리고 줄바꿈)로 맞춘 결재현황 카드. 기존 표(<table>)
// 대신 이걸 그리드로 나열한다 — "문서명 안 잘리게" 요청이 표 컬럼 폭 제약보다
// 카드 쪽이 자연스럽게 지켜진다.
function ApprovalCard({ item }) {
  const bucket = statusBucket(item.status);
  // 2026-09-08: 완료/반려는 "이미 끝난 건"이라 진행중인 건과 구분되게 카드
  // 전체를 중립톤으로 다시 칠한다(StatusChangePage.jsx의 StatusChangeCard와
  // 같은 처리 — 자세한 이유는 그쪽 주석 참고).
  const finished = bucket !== "progress";
  return (
    <div
      className={`border rounded-[18px] overflow-hidden ${
        finished ? "bg-[#F7F8FB] border-[#E9EBF2]" : "bg-white border-brand-border"
      }`}
    >
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b ${
          finished ? "border-[#E9EBF2] bg-[#F1F2F7]" : "border-brand-border bg-brand-alt/60"
        }`}
      >
        <span
          className={`text-[11px] font-bold px-2.5 py-[3px] rounded-full ${
            finished ? "bg-[#E9EBF2] text-brand-muted" : typeTagClass(item)
          }`}
        >
          {typeLabel(item)}
        </span>
        <span className="text-[11px] text-brand-muted flex-shrink-0">{item.date}</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-[11px] text-brand-muted font-semibold truncate">{item.deptNm || "부서 미상"}</p>
        <p
          className={`text-[13.5px] font-bold leading-snug mt-1 ${
            finished ? "text-[#8B8FA3]" : "text-brand-navy"
          }`}
        >
          {item.subject}
        </p>
        <div className="flex items-center justify-between gap-2 mt-3">
          <span className="text-[11px] text-brand-muted truncate" title={formatStatusCode(item.status)}>
            {whoLine(item, bucket)}
          </span>
          <span
            className={`text-[11px] font-bold px-2.5 py-[3px] rounded-full flex-shrink-0 ${
              finished ? FINISHED_BADGE[bucket] : BUCKET_META[bucket].badge
            }`}
          >
            {BUCKET_META[bucket].label}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalStatusPage() {
  const [expenseItems, setExpenseItems] = useState([]);
  const [internalItems, setInternalItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState({ expense: null, internal: null });
  const [tab, setTab] = useState("all");
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([fetchExpenseTravelList(), fetchInternalDraftList()]).then(([exp, intr]) => {
      if (cancelled) return;
      if (exp.status === "fulfilled") {
        // 2026-09-07: 정규화(normalizeExpenseItem)로 만든 sortKey가 raw 날짜
        // 문자열 그대로라 여기서 바로 최근 30일 필터를 걸 수 있다.
        setExpenseItems((exp.value || []).map(normalizeExpenseItem).filter((it) => isRecentRawDate(it.sortKey)));
        // ⚠️ 2026-08-23(10) 디버그용: lastAprvUser/aprvLevel 필드가 이 화면
        // 응답에 실제로 오는지 콘솔로 바로 확인 가능하게 원본 행 하나를 남김.
        // "OOO 결재중" 표시가 안 뜨면 이 로그로 필드명이 다른지부터 확인할 것.
        if (exp.value?.[0]) console.debug("[ApprovalStatusPage] 지출/출장 원본 필드 샘플:", exp.value[0]);
      } else {
        console.warn("[ApprovalStatusPage] 지출/출장결재현황 조회 실패:", exp.reason);
        setErrors((e) => ({ ...e, expense: exp.reason?.message || "조회 실패" }));
      }
      if (intr.status === "fulfilled") {
        setInternalItems((intr.value || []).map(normalizeInternalItem).filter((it) => isRecentRawDate(it.sortKey)));
        if (intr.value?.[0]) console.debug("[ApprovalStatusPage] 내부기안 원본 필드 샘플:", intr.value[0]);
      } else {
        console.warn("[ApprovalStatusPage] 내부기안결재현황 조회 실패:", intr.reason);
        setErrors((e) => ({ ...e, internal: intr.reason?.message || "조회 실패" }));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const allItems = useMemo(
    () => [...expenseItems, ...internalItems].sort(sortByDateDesc),
    [expenseItems, internalItems]
  );

  const scoped = tab === "expense" ? expenseItems : tab === "internal" ? internalItems : allItems;
  const query = searchText.replace(/\s+/g, "").toLowerCase();
  const filtered = query
    ? scoped.filter((it) => `${it.subject}${it.deptNm}`.replace(/\s+/g, "").toLowerCase().includes(query))
    : scoped;
  // ⚠️ 2026-08-23(9): allItems만 정렬돼 있고 지출/출장·내부기안 개별 탭은
  // API가 준 원래 순서 그대로 나가던 버그 — 어느 탭이든 항상 최신순으로
  // 보이도록 여기서 한 번 더 정렬한다(이미 정렬된 배열이면 그대로 유지되니
  // 안전하다).
  const visible = useMemo(() => [...filtered].sort(sortByDateDesc), [filtered]);

  const hasAnyError = errors.expense || errors.internal;

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-brand-navy">결재 현황</h2>
        <p className="text-sm text-brand-muted mt-0.5">
          ERP 연동 지출·출장 및 내부기안 결재 현황을 통합 관리합니다. (최근 {RECENT_APPROVAL_DAYS}일 이내 건만 표시)
        </p>
      </div>

      {hasAnyError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-3.5 py-2.5">
          {errors.expense && <p>지출/출장결재현황 조회 실패: {errors.expense}</p>}
          {errors.internal && <p>내부기안결재현황 조회 실패: {errors.internal}</p>}
          <p className="text-xs text-amber-600 mt-1">
            ERP 세션이 만료됐거나 일시적인 오류일 수 있어요 — kis.kbu.ac.kr에 로그인 상태인지 확인 후 새로고침해보세요.
          </p>
        </div>
      )}

      {/* 2026-09-08: "학적변동/협조문 탭이랑 통일성 있게" 요청 — 학적변동과
          같은 12칸 그리드(좌측 4/3칸 요약 패널 + 우측 8/9칸 카드 리스트)로
          재구성. 기존에 있던 전체/지출·출장/내부기안 3타일 grid는
          ApprovalSummaryPanel 안 KPI 타일로 흡수됐다. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 xl:col-span-3">
          <ApprovalSummaryPanel items={allItems} />
        </div>

        <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-brand-alt rounded-lg p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                    tab === t.key ? "bg-white text-brand-blue shadow-sm" : "text-brand-muted hover:text-brand-navy"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="문서명, 부서 검색"
              className="border border-brand-border rounded-md px-3 py-1.5 text-sm bg-white w-full max-w-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>

          {loading ? (
            <div className="text-brand-muted text-sm py-6 text-center bg-white border border-brand-border rounded-xl">
              불러오는 중...
            </div>
          ) : visible.length === 0 ? (
            <div className="text-brand-muted text-sm py-6 text-center bg-white border border-brand-border rounded-xl">
              해당하는 결재 항목이 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {visible.map((it) => (
                <ApprovalCard key={`${it.source}-${it.id}`} item={it} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
