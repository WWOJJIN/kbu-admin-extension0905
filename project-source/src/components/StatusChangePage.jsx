// src/components/StatusChangePage.jsx
// 학적변동 탭. 2026-09-02 리디자인 — 팀에서 공유한 목업(벤토 그리드 + 현황
// 통계 + 카드형 리스트)에 맞춰 레이아웃을 바꿨다. 다만 목업 그대로 옮기지는
// 않았고 두 가지는 의도적으로 바꿨다:
//   1) 목업의 사이드바/탑바는 안 씀 — 이 앱은 이미 Navbar.jsx가 상단 탭으로
//      역할을 하고 있어서, 사이드바를 또 넣으면 레이아웃이 중복된다. 이
//      컴포넌트는 페이지 본문(App.jsx의 <Page /> 자리)만 담당한다.
//   2) 목업의 "AI 분석 요약"(예: "휴학 신청이 전년 대비 15% 증가")과
//      "승인 처리" 버튼은 뺐다 — 둘 다 이 앱이 실제로 할 수 없는 일이다.
//      AI 분석은 프록시 배포 전이라 텍스트를 지어내는 셈이 되고, "승인
//      처리"는 ERP에 결재를 쓰는 기능인데 이 앱은 애초에 조회 전용(폴링
//      결과를 IndexedDB에서 읽기만 함, 아래 설명 참고)이라 실제로 아무 일도
//      안 하는 가짜 버튼이 된다. 대신 "현황 요약" 패널은 지금 가진 데이터만
//      으로 실제로 계산 가능한 값(사유별 건수, 어느 승인 단계에 몇 건이
//      몰려있는지)을 보여준다.
//
// 데이터 자체는 계속 extension/background.js의 pollStatusChanges가 폴링해서
// IndexedDB(statusChanges 스토어)에 쌓아두고, 이 화면은 그 결과를 읽기만
// 한다 — 화면을 열 때마다 ERP를 다시 조회하지 않는다.

import { useEffect, useMemo, useState } from "react";
import { getAllStatusChanges } from "../lib/db.js";

const REFRESH_MS = 15000;

// kbu 원본 fmtDate: "20260824" 같은 8자리 문자열을 "2026-08-24"로.
function fmtDate(raw) {
  if (!raw) return "-";
  const digits = String(raw).replace(/\D/g, "").slice(0, 8);
  if (digits.length < 8) return String(raw);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

// ⚠️ 2026-09-02 버그 수정: "반려된 단계도 다음 단계 승인이 된 것처럼 보인다"는
// 리포트로 확인해보니, 기존 로직이 accpGbnNm이 "미승인"이 아니기만 하면
// 전부 "이 단계는 끝났다(=진행됨)"로 취급하고 있었다. 근데 실제로 이 필드는
// "미승인" 외에도 "반려"라는 값이 온다(팀 기획서 6절 결재현황 상태값 목록에도
// "대기/진행/완료/반려/결재취소"가 있었음, 학적변동 승인단계도 동일 체계로
// 보임) — 반려는 "이 단계를 통과해서 다음으로 넘어감"이 아니라 "여기서
// 멈췄다"는 뜻인데, 예전 로직은 이걸 승인과 구분 안 하고 그냥 doneCount에
// 포함시켜서 다음 단계를 마치 "지금 여기가 대기중"인 것처럼 보여줬다.
// 아래부터는 각 단계를 approved/rejected/pending 3가지로 명확히 구분한다.
function stageStatus(stage) {
  const v = stage?.accpGbnNm;
  if (!v || v === "미승인") return "pending";
  if (v.includes("반려")) return "rejected";
  return "approved";
}

function isRejected(item) {
  return (item.stages || []).some((s) => stageStatus(s) === "rejected");
}

// 모든 단계가 "승인"으로 끝났을 때만 완료로 본다 — 반려가 하나라도 있으면
// 그 뒤 단계가 전부 "미승인"(아직 안 옴)이라 해도 완료가 아니라 반려 상태다.
function isDone(item) {
  const stages = item.stages || [];
  if (stages.length === 0) return false;
  if (isRejected(item)) return false;
  return stages.every((s) => stageStatus(s) === "approved");
}

function doneCountOf(item) {
  return (item.stages || []).filter((s) => stageStatus(s) === "approved").length;
}

// 지금 "걸려있는" 단계 — 아직 승인이 안 된 첫 단계(미승인이든 반려든). 반려된
// 단계를 건너뛰고 그 다음 단계를 "대기중"으로 보여주면 안 되므로, approved가
// 아닌 첫 단계를 그대로 반환한다.
function currentStage(item) {
  const stages = item.stages || [];
  return stages.find((s) => stageStatus(s) !== "approved") || null;
}

// 2026-09-02(4): 실사용자가 반려된 건의 "원본 데이터 보기"로 직접 확인해서
// 알려준 필드명 — 반려 사유는 recaResn에 온다("입영통지서 일부분이 아닌,
// 전체 파일을 업로드해 주세요." 같은 텍스트로 확인됨). 이제 이 필드를
// 최우선으로 쓰고, 혹시 다른 반려 유형에서 다른 필드명이 쓰이는 경우까지
// 대비해서 예전 휴리스틱 추정도 폴백으로 남겨둔다.
const KNOWN_REASON_KEY = "recaResn";
const REASON_KEY_HINTS = ["rsn", "cmnt", "rmrk", "sayu", "bigo", "memo", "desc", "reason"];
function guessRejectReason(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;
  if (typeof rawRow[KNOWN_REASON_KEY] === "string" && rawRow[KNOWN_REASON_KEY].trim()) {
    return { key: KNOWN_REASON_KEY, value: rawRow[KNOWN_REASON_KEY], confirmed: true };
  }
  for (const [key, value] of Object.entries(rawRow)) {
    if (["accpObjGbnNm", "accpGbnNm", "empNm"].includes(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    const lowerKey = key.toLowerCase();
    if (REASON_KEY_HINTS.some((hint) => lowerKey.includes(hint))) return { key, value, confirmed: false };
  }
  return null;
}

// 변동 구분(휴학/복학/자퇴 등) 문자열에 따라 배지 색을 매핑. ERP가 주는 값이
// 계정/학기마다 조금씩 다를 수 있어서 하드코딩 목록 대신 키워드로 느슨하게
// 매칭하고, 못 알아본 값은 기본(블루) 색으로 떨어진다.
function reasonTone(label) {
  const text = label || "";
  if (text.includes("자퇴") || text.includes("제적")) return "bg-status-redBg text-status-red";
  if (text.includes("복학")) return "bg-status-greenBg text-status-green";
  if (text.includes("휴학")) return "bg-status-amberBg text-status-amber";
  return "bg-brand-alt text-brand-blueDark";
}

// 이름 이니셜 아바타 색상 — 학번 기준으로 고정 팔레트 중 하나를 결정론적으로
// 골라서 같은 학생은 항상 같은 색이 나오게 함(랜덤이면 새로고침마다 바뀜).
const AVATAR_PALETTE = ["bg-brand-blue", "bg-status-violet", "bg-status-green", "bg-status-amber", "bg-brand-blueDark"];
function avatarTone(key) {
  const str = String(key || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[hash];
}

function StatusBadge({ item }) {
  const rejected = isRejected(item);
  const done = isDone(item);
  const total = (item.stages || []).length;
  const label = rejected ? "반려" : item.accpCnt || `${doneCountOf(item)}/${total || "?"}`;
  const tone = rejected
    ? "bg-status-redBg text-status-red"
    : done
    ? "bg-status-greenBg text-status-green"
    : "bg-brand-alt text-brand-blueDark";
  return <span className={`text-[10.5px] font-bold px-2 py-[3px] rounded-[6px] flex-shrink-0 ${tone}`}>{label}</span>;
}

// 목업의 세그먼트형 진행바를 실제 stages 개수만큼 나눠서 그린다. 반려된
// 단계는 파란색(진행)이 아니라 빨간색으로 표시해서 "여기서 막혔다"는 걸
// 다음 단계(아직 안 옴, 회색)와도 승인 완료 단계(파란색)와도 구분한다.
function ProgressSegments({ item }) {
  const stages = item.stages || [];
  if (stages.length === 0) return null;
  return (
    <div className="flex gap-1 h-1.5 w-full">
      {stages.map((s, i) => {
        const status = stageStatus(s);
        const tone =
          status === "approved" ? "bg-brand-blue" : status === "rejected" ? "bg-status-red" : "bg-brand-border";
        return <div key={i} className={`flex-1 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

function StatTile({ label, value, tone }) {
  return (

    <div className="bg-white rounded-2xl p-4 border border-brand-border flex items-center justify-between">
      <div>
        <p className="text-[11px] text-brand-muted font-semibold tracking-wide">{label}</p>
        <p className={`text-2xl font-extrabold mt-1 ${tone || "text-brand-navy"}`}>{value}</p>
      </div>
    </div>
  );
}

function StatusChangeCard({ item, onClick }) {
  const reasonLine = [item.schregModGbnNm, item.schregModResnGbnNm].filter(Boolean).join(" · ");
  const detailReason = item.schregModDetaResnGbnNm ? ` (${item.schregModDetaResnGbnNm})` : "";
  const stage = currentStage(item);
  const stageIsRejected = stage && stageStatus(stage) === "rejected";
  const initial = (item.stdKorNm || "?").slice(0, 1);

  let stageLine;
  if (stageIsRejected) {
    stageLine = `${stage.accpObjGbnNm || "승인"} 단계에서 반려됨`;
  } else if (stage) {
    stageLine = `${stage.accpObjGbnNm} 승인 대기`;
  } else if ((item.stages || []).length === 0) {
    stageLine = "승인단계 정보 없음";
  } else {
    stageLine = "모든 단계 승인 완료";
  }

  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border rounded-[18px] overflow-hidden transition-shadow hover:shadow-brand hover:-translate-y-0.5 ${
        stageIsRejected ? "border-status-red/40" : "border-brand-border"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border bg-brand-alt/60">
        <span className={`text-[11px] font-bold px-2.5 py-[3px] rounded-full ${reasonTone(item.schregModGbnNm)}`}>
          {item.schregModGbnNm || "변동"}
        </span>
        <span className="text-[11px] text-brand-muted">신청 {fmtDate(item.schregModAplyDt)}</span>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold ${avatarTone(
              item.stuno
            )}`}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-brand-navy leading-snug truncate">
              {item.stdKorNm || "(이름 없음)"}{" "}
              <span className="text-[11px] text-brand-muted font-normal">{item.stuno}</span>
            </p>
            <p className="text-[11px] text-brand-muted truncate">{item.deptNm}</p>
          </div>
        </div>

        <p className="text-[11px] text-brand-muted mt-3 truncate">
          {reasonLine}
          {detailReason}
        </p>

        <div className="mt-3">
          <div className="flex justify-between items-center mb-1.5">
            <span className={`text-[11px] truncate ${stageIsRejected ? "text-status-red font-semibold" : "text-brand-muted"}`}>
              {stageLine}
            </span>
            <StatusBadge item={item} />
          </div>
          <ProgressSegments item={item} />
        </div>
      </div>
    </button>
  );
}

function StageRow({ stage }) {
  const status = stageStatus(stage);
  const [showRaw, setShowRaw] = useState(false);
  const tone =
    status === "approved"
      ? "bg-status-greenBg text-status-green"
      : status === "rejected"
      ? "bg-status-redBg text-status-red"
      : "bg-status-amberBg text-status-amber";
  const guessedReason = status === "rejected" ? guessRejectReason(stage.raw) : null;

  return (
    <div className="border border-brand-border rounded-[10px] px-3 py-2.5 text-[12.5px]">
      <div className="flex items-center justify-between">
        <span>
          <span className="font-semibold text-brand-navy">{stage.accpObjGbnNm}</span>
          {stage.empNm && <span className="text-brand-muted text-[11.5px] ml-2">{stage.empNm}</span>}
        </span>
        <span className={`text-[11px] font-bold px-2.5 py-[3px] rounded-full ${tone}`}>
          {stage.accpGbnNm || "미승인"}
        </span>
      </div>

      {status === "rejected" && (
        <div className="mt-1.5 pt-1.5 border-t border-status-red/15">
          {guessedReason ? (
            <p className="text-status-red text-[12px]">
              반려 사유: {guessedReason.value}
              {!guessedReason.confirmed && (
                <span className="text-brand-muted text-[10.5px]"> (필드 {guessedReason.key} 추정값)</span>
              )}
            </p>
          ) : (
            <p className="text-brand-muted text-[11.5px]">
              반려 사유로 보이는 필드를 못 찾았어요. 아래에서 원본 응답을 직접 확인해보세요.
            </p>
          )}
          {stage.raw && (
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[11px] text-brand-blue hover:text-brand-blueDark mt-1"
            >
              {showRaw ? "원본 데이터 숨기기" : "원본 데이터 보기"}
            </button>
          )}
          {showRaw && stage.raw && (
            <pre className="mt-1.5 text-[10.5px] bg-brand-alt rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(stage.raw, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChangeModal({ item, onClose }) {
  if (!item) return null;
  const reasonLine = [item.schregModResnGbnNm || "-"].join("");
  const rejected = isRejected(item);
  return (
    <div
      className="fixed inset-0 bg-brand-navy/45 flex items-center justify-center z-[60] p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-[560px] max-w-full max-h-[86vh] overflow-y-auto rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <div className="flex items-start justify-between px-[22px] pt-5">
          <div>
            <p className="text-[11.5px] font-semibold text-brand-muted">
              {item.deptNm} · {item.stuno}
            </p>
            <p className="text-base font-bold mt-1 leading-snug text-brand-navy flex items-center gap-2 flex-wrap">
              {item.stdKorNm || "(이름 없음)"} — {item.schregModGbnNm}
              {rejected && (
                <span className="text-[11px] font-bold px-2 py-[2px] rounded-full bg-status-redBg text-status-red">
                  반려
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-brand-alt text-brand-muted text-[13px] flex-shrink-0"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-2.5 mx-[22px] mt-3 text-[11.5px] text-brand-muted flex-wrap">
          <span>
            사유: {reasonLine}
            {item.schregModDetaResnGbnNm ? ` (${item.schregModDetaResnGbnNm})` : ""}
          </span>
          <span>·</span>
          <span>지도교수 {item.tutorNm || "-"}</span>
          <span>·</span>
          <span>신청일 {fmtDate(item.schregModAplyDt)}</span>
        </div>

        <div className="mx-[22px] mt-4">
          <p className="text-[11px] font-bold text-brand-muted mb-1.5">승인 단계</p>
          <div className="flex flex-col gap-2">
            {!item.stages || item.stages.length === 0 ? (
              <p className="text-brand-muted text-xs py-1.5">승인단계 정보가 없습니다.</p>
            ) : (
              item.stages.map((s, i) => <StageRow key={i} stage={s} />)
            )}
          </div>
        </div>

        <div className="flex items-center justify-end px-[22px] py-[22px] mt-3">
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md bg-brand-blue text-white hover:bg-brand-blueDark"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// 현황 요약 패널: "AI가 분석"한 척하는 문장 대신, 지금 있는 데이터로 실제
// 계산 가능한 두 가지만 보여준다 — 사유별 분포, 대기 중인 승인 단계별 분포.
function SummaryPanel({ items }) {
  const reasonCounts = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const key = item.schregModGbnNm || "기타";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const stageCounts = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (isDone(item)) continue;
      const stage = currentStage(item);
      if (!stage || stageStatus(stage) === "rejected") continue; // 반려는 아래 별도 집계
      const label = stage.accpObjGbnNm;
      if (!label) continue;
      map.set(label, (map.get(label) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const rejectedCount = useMemo(() => items.filter(isRejected).length, [items]);

  return (
    <div className="bg-white rounded-[20px] p-5 border border-status-violet/25 relative overflow-hidden">
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-status-violetBg rounded-full blur-2xl" />
      <h3 className="text-[13px] font-bold text-status-violet mb-3 relative">현황 요약</h3>
      <div className="relative flex flex-col gap-3 text-[12px]">
        <div>
          <p className="text-brand-muted font-semibold mb-1">사유별 분포</p>
          {reasonCounts.length === 0 ? (
            <p className="text-brand-muted">데이터 없음</p>
          ) : (
            <p className="text-brand-navy leading-relaxed">
              {reasonCounts.map(([label, count]) => `${label} ${count}건`).join(" · ")}
            </p>
          )}
        </div>
        <div>
          <p className="text-brand-muted font-semibold mb-1">대기 중인 승인 단계</p>
          {stageCounts.length === 0 ? (
            <p className="text-brand-muted">대기 중인 항목 없음</p>
          ) : (
            <p className="text-brand-navy leading-relaxed">
              {stageCounts.map(([label, count]) => `${label} ${count}건`).join(" · ")}
            </p>
          )}
        </div>
        {rejectedCount > 0 && (
          <div>
            <p className="text-status-red font-semibold mb-1">반려</p>
            <p className="text-status-red leading-relaxed">{rejectedCount}건 — 승인단계 참고</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterPanel({ items, search, setSearch, reasonFilter, setReasonFilter, statusFilter, setStatusFilter }) {
  const reasonOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.schregModGbnNm).filter(Boolean));
    return [...set];
  }, [items]);

  return (
    <div className="bg-white rounded-[20px] p-5 border border-brand-border flex-1">
      <h3 className="text-[13px] font-bold text-brand-navy mb-3">필터링</h3>
      <div className="flex flex-col gap-3.5">
        <div>
          <label className="block text-[11px] text-brand-muted font-semibold mb-1">이름·학번 검색</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 학번"
            className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-[11px] text-brand-muted font-semibold mb-1">변동 구분</label>
          <select
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
            className="w-full border border-brand-border rounded-lg px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="all">전체</option>
            {reasonOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-brand-muted font-semibold mb-1">진행 상태</label>
          <div className="flex gap-1.5">
            {[
              { key: "all", label: "전체" },
              { key: "pending", label: "처리중" },
              { key: "rejected", label: "반려" },
              { key: "done", label: "완료" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors ${
                  statusFilter === opt.key
                    ? "bg-brand-blue text-white"
                    : "bg-brand-alt text-brand-muted hover:text-brand-navy"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StatusChangePage() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getAllStatusChanges()
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch((err) => console.warn("[StatusChangePage] 학적변동 목록 로드 실패:", err));
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (reasonFilter !== "all" && item.schregModGbnNm !== reasonFilter) return false;
      if (statusFilter === "pending" && (isDone(item) || isRejected(item))) return false;
      if (statusFilter === "rejected" && !isRejected(item)) return false;
      if (statusFilter === "done" && !isDone(item)) return false;
      if (query) {
        const haystack = `${item.stdKorNm || ""}${item.stuno || ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [items, search, reasonFilter, statusFilter]);

  // ⚠️ 반려는 "완료"도 "처리중"도 아닌 별도 상태 — 처리 대기 집계에서 반려
  // 건을 빼야 "처리 대기" 숫자가 실제로 대응이 필요한 건수와 맞는다.
  const pendingCount = useMemo(() => items.filter((i) => !isDone(i) && !isRejected(i)).length, [items]);
  const doneCount = useMemo(() => items.filter(isDone).length, [items]);
  const rejectedCount = useMemo(() => items.filter(isRejected).length, [items]);

  const selected = items.find((it) => it.id === selectedId) || null;

  const listTitle =
    statusFilter === "all"
      ? "전체 신청"
      : statusFilter === "pending"
      ? "처리중인 신청"
      : statusFilter === "rejected"
      ? "반려된 신청"
      : "완료된 신청";

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-brand-navy">학적변동</h2>
        <p className="text-sm text-brand-muted mt-0.5">
          학적변동대상자목록(휴학·복학 등) 신청과 승인 단계별 진행 현황을 확인해요.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-brand-muted text-sm py-6 text-center bg-white border border-brand-border rounded-xl">
          감지된 학적변동 신청이 없습니다. (동기화 후 표시됩니다 — 설정 탭에서 이 기능이 켜져 있는지 확인해보세요.)
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 왼쪽: 현황 요약 + 필터 */}
          <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-5">
            <SummaryPanel items={items} />
            <FilterPanel
              items={items}
              search={search}
              setSearch={setSearch}
              reasonFilter={reasonFilter}
              setReasonFilter={setReasonFilter}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
            />
          </div>

          {/* 오른쪽: 통계 타일 + 카드 리스트 */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-5">
            <div className="grid grid-cols-4 gap-3">
              <StatTile label="전체 신청" value={items.length} />
              <StatTile label="처리 대기" value={pendingCount} tone="text-brand-blue" />
              <StatTile label="반려" value={rejectedCount} tone="text-status-red" />
              <StatTile label="완료" value={doneCount} tone="text-status-green" />
            </div>

            <div className="flex items-baseline justify-between">
              <h3 className="text-[15px] font-bold text-brand-navy">{listTitle}</h3>
              <p className="text-[12px] text-brand-muted">{filtered.length}건</p>
            </div>

            {filtered.length === 0 ? (
              <div className="text-brand-muted text-sm py-6 text-center bg-white border border-brand-border rounded-xl">
                조건에 맞는 학적변동 신청이 없습니다.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {filtered.map((item) => (
                  <StatusChangeCard key={item.id} item={item} onClick={() => setSelectedId(item.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <StatusChangeModal item={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
