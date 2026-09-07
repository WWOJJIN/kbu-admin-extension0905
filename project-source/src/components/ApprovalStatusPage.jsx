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

// 결재가 아직 끝나지 않은 것으로 볼 코드. 이 상태일 때만 "OOO 결재중" 형태로
// 바꿔서 보여준다(완료/반려/취소된 건에 마지막 결재자 이름을 "결재중"이라고
// 붙이면 오해를 주니까).
const IN_PROGRESS_CODES = new Set(["01", "02"]);

function formatStatusCode(code) {
  if (!code) return "-";
  const label = STATUS_LABELS[code];
  return label ? `${label} (${code})` : code;
}

/**
 * 2026-08-23(10) 최초 작성 당시엔 lastAprvUser를 "현재 결재중인 사람"으로
 * 잘못 이해해서 `${lastAprvUser} 결재중`으로 조합해 보여주고 있었다.
 *
 * ⚠️ 2026-08-26 정정 (실사용 리포트 + 실측으로 확인): findIntAprvDraftList.do를
 * 실제로 호출해서 aprvNo=00133695 문서를 까보니 lastAprvUser="임현서"인데
 * 실제로 지금 결재중인 사람은 "김양진"이었음 — 즉 lastAprvUser는 "현재
 * 결재자"가 아니라 "마지막으로 이미 결재를 처리(완료)한 사람"이었다(db.js의
 * JSDoc에도 원래 "마지막으로 처리한 결재자 이름"이라고 정확히 적혀있었는데
 * 이 컴포넌트만 다르게 오해하고 있었음). 반면 aprvLevel 필드는 ERP가 이미
 * "김양진 결재중"처럼 완성된 표시 문자열로 내려주므로, 추가 조합 없이
 * 그대로 쓰면 된다. 진행 중인 건이고 aprvLevel이 실제로 왔으면 그대로
 * 보여주고, 없으면(이 화면 응답에 해당 필드가 없거나, 완료/반려 등 종료된
 * 상태면) 코드 기반 라벨(formatStatusCode)로 대체 표시한다.
 */
function formatApprovalStatus(item) {
  if (item.aprvLevel && IN_PROGRESS_CODES.has(item.status)) {
    return item.aprvLevel;
  }
  return formatStatusCode(item.status);
}

// 2026-08-23(12): "지출/출장이든 내부기안이든 완료가 아니면 상태 색상 넣어줘"
// 요청 — 완료(03)만 기본(회색) 배지로 두고, 그 외(대기/진행/반려/취소/미확인
// 코드 전부 포함)는 눈에 띄는 색으로 강조한다. 반려/취소(04/05)는 완료가
// 아니면서 "끝난" 상태라 따로 빨간 계열로 구분하고, 나머지(대기/진행/추정
// 불가)는 주황 계열로 통일.
function statusBadgeClass(code) {
  if (code === "03") return "bg-brand-alt text-brand-muted"; // 완료
  if (code === "04" || code === "05") return "bg-red-50 text-red-600"; // 반려/결재취소
  return "bg-amber-50 text-amber-700"; // 대기/진행/그 외 미완료
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
    <div className="p-4 max-w-5xl mx-auto">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-brand-border rounded-xl px-4 py-3">
          <p className="text-xs text-brand-muted mb-1.5">전체</p>
          <p className="text-2xl font-medium text-brand-navy">{allItems.length}건</p>
        </div>
        <div className="bg-white border border-brand-border rounded-xl px-4 py-3">
          <p className="text-xs text-brand-muted mb-1.5">지출/출장</p>
          <p className="text-2xl font-medium text-brand-navy">{expenseItems.length}건</p>
        </div>
        <div className="bg-white border border-brand-border rounded-xl px-4 py-3">
          <p className="text-xs text-brand-muted mb-1.5">내부기안</p>
          <p className="text-2xl font-medium text-brand-navy">{internalItems.length}건</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-3">
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

      <div className="bg-white border border-brand-border rounded-xl overflow-hidden">
        {loading ? (
          <p className="text-sm text-brand-muted px-4 py-6 text-center">불러오는 중...</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-brand-muted px-4 py-6 text-center">해당하는 결재 항목이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-brand-muted text-xs">
                <th className="px-4 py-2 font-medium w-12 whitespace-nowrap">번호</th>
                <th className="px-4 py-2 font-medium">문서명</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">부서</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">일자</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">구분</th>
                <th className="px-4 py-2 font-medium whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it, idx) => (
                <tr key={`${it.source}-${it.id}`} className="border-b border-slate-50 last:border-b-0">
                  <td className="px-4 py-2.5 text-brand-muted whitespace-nowrap">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-brand-navy">{it.subject}</td>
                  <td className="px-4 py-2.5 text-brand-muted whitespace-nowrap">{it.deptNm}</td>
                  <td className="px-4 py-2.5 text-brand-muted whitespace-nowrap">{it.date}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="text-[11px] font-medium bg-brand-alt text-brand-muted px-2 py-0.5 rounded">
                      {it.source === "expense" ? "지출/출장" : (it.docDivNm || "내부기안")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${statusBadgeClass(it.status)}`}>
                      {formatApprovalStatus(it)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
