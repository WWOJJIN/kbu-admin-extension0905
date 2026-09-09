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
// 2026-09-07(16): "지도교수 건너뛰더라도 윗단계에서 승인 때리면 문제 없다"는
// 실사용 피드백 — 원래는 "단계가 4개면 4개 다 승인"이어야만 완료로 봤는데,
// 실제 결재 관행은 그렇지 않다. 상위 결재권자(뒤 단계)가 먼저/직접 승인하면
// 그 앞의 하위 단계(예: 지도교수) 승인은 형식상 안 찍혀 있어도 실무적으로는
// 이미 끝난 일이다. 그래서 "마지막(최종) 단계가 승인"이면, 그 앞 단계 중
// 아직 미승인인 게 남아있어도 전체를 완료로 본다(반려가 하나라도 있으면
// 여전히 완료 아님 — 그건 그대로 최우선 처리).
function isDone(item) {
  const stages = item.stages || [];
  if (stages.length === 0) return false;
  if (isRejected(item)) return false;
  if (stages.every((s) => stageStatus(s) === "approved")) return true;
  const last = stages[stages.length - 1];
  return stageStatus(last) === "approved";
}

// 완료 여부와 별개로 "몇 단계나 실제로 승인 도장이 찍혔는지"는 그대로 보여줘야
// 하므로(진행바/배지의 N/전체 표시), 이 카운트 자체는 순서와 무관하게 승인된
// 단계 수를 그대로 센다 — 위 isDone()의 "최종 단계 승인 시 완료" 예외와는
// 별개 지표.
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

// 2026-09-08: "반려·완료된 카드는 전체를 중립톤으로" 요청 — 이미 끝난 건은
// 진행중인 건과 한눈에 구분되게 무채색 계열로 다시 칠한다(CSS 필터가 아니라
// 색상 값 자체를 바꾸는 방식 — 방식 C, 완료/반려 라벨 자체는 그대로 남긴다).
// 완료는 중립 회색, 반려는 톤 다운된 빨강으로 — 진행중(bg-brand-alt
// text-brand-blueDark)만 원래 포인트 컬러를 유지한다.
function StatusBadge({ item }) {
  const rejected = isRejected(item);
  const done = isDone(item);
  const total = (item.stages || []).length;
  const label = rejected ? "반려" : item.accpCnt || `${doneCountOf(item)}/${total || "?"}`;
  const tone = rejected
    ? "bg-[#F3E4E4] text-[#B36569]"
    : done
    ? "bg-[#E9EBF2] text-brand-muted"
    : "bg-brand-alt text-brand-blueDark";
  return <span className={`text-[10.5px] font-bold px-2 py-[3px] rounded-[6px] flex-shrink-0 ${tone}`}>{label}</span>;
}

// 목업의 세그먼트형 진행바를 실제 stages 개수만큼 나눠서 그린다. 반려된
// 단계는 파란색(진행)이 아니라 빨간색으로 표시해서 "여기서 막혔다"는 걸
// 다음 단계(아직 안 옴, 회색)와도 승인 완료 단계(파란색)와도 구분한다.
// 2026-09-08: 카드 전체가 끝난 건(반려 또는 완료)이면 진행바도 위 StatusBadge와
// 같은 무채색 톤으로 낮춘다 — 진행중인 카드만 원색(파랑/빨강)으로 눈에 띈다.
function ProgressSegments({ item }) {
  const stages = item.stages || [];
  if (stages.length === 0) return null;
  const finished = isRejected(item) || isDone(item);
  return (
    <div className="flex gap-1 h-1.5 w-full">
      {stages.map((s, i) => {
        const status = stageStatus(s);
        const tone =
          status === "approved"
            ? finished
              ? "bg-[#C4C8D6]"
              : "bg-brand-blue"
            : status === "rejected"
            ? finished
              ? "bg-[#D9A3A5]"
              : "bg-status-red"
            : "bg-brand-border";
        return <div key={i} className={`flex-1 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

// 2026-09-07(17): "전체신청/처리대기/반려/완료 타일 없애고 현황요약 안으로"
// 요청으로 이 타일을 쓰던 자리가 없어져서, StatTile 자체도 죽은 코드로 안
// 남기려고 정의를 삭제(같은 통계는 이제 SummaryPanel 안의 2x2 박스로 나옴).

function StatusChangeCard({ item, onClick }) {
  const reasonLine = [item.schregModGbnNm, item.schregModResnGbnNm].filter(Boolean).join(" · ");
  const detailReason = item.schregModDetaResnGbnNm ? ` (${item.schregModDetaResnGbnNm})` : "";
  const stage = currentStage(item);
  const stageIsRejected = stage && stageStatus(stage) === "rejected";
  const initial = (item.stdKorNm || "?").slice(0, 1);
  const stages = item.stages || [];
  // 2026-09-07(16): isDone()이 "최종 단계 승인 시 완료" 예외를 갖게 되면서,
  // currentStage()(첫 미승인 단계)만 보고 문구를 정하면 "지도교수 승인 대기"
  // 처럼 이미 실무적으로 끝난 건을 아직 대기 중인 것처럼 보여주는 문제가
  // 생긴다. isDone(item)을 먼저 확인해서, 완료로 처리된 건이면 그 앞의
  // 미승인 단계는 문구에서 언급하지 않는다.
  const allApproved = stages.length > 0 && stages.every((s) => stageStatus(s) === "approved");
  const effectivelyDone = !stageIsRejected && isDone(item);
  // 2026-09-08: "반려 또는 과정이 끝난 건은 카드 전체를 중립톤으로" 요청 —
  // isRejected/isDone은 이미 KPI 집계(SummaryPanel)에서 쓰는 것과 동일한
  // 판정 기준이라, 여기서도 그대로 재사용해서 "완료/반려로 집계되는 건과
  // 카드가 흐려지는 건"이 항상 같은 기준으로 일치하게 했다.
  const finished = isRejected(item) || isDone(item);

  let stageLine;
  if (stageIsRejected) {
    stageLine = `${stage.accpObjGbnNm || "승인"} 단계에서 반려됨`;
  } else if (effectivelyDone && allApproved) {
    stageLine = "모든 단계 승인 완료";
  } else if (effectivelyDone) {
    // 중간 단계가 미승인으로 남아있지만 최종 단계가 승인된 경우 — 있는
    // 그대로("전부 다 됐다"고 거짓으로 말하지 않고) 어느 단계가 생략됐는지
    // 보여준다.
    stageLine = `최종 승인 완료 (${stage ? `${stage.accpObjGbnNm} 생략` : "일부 단계 생략"})`;
  } else if (stage) {
    stageLine = `${stage.accpObjGbnNm} 승인 대기`;
  } else if (stages.length === 0) {
    stageLine = "승인단계 정보 없음";
  } else {
    stageLine = "모든 단계 승인 완료";
  }

  return (
    <button
      onClick={onClick}
      className={`text-left border rounded-[18px] overflow-hidden transition-shadow hover:shadow-brand hover:-translate-y-0.5 ${
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
            finished ? "bg-[#E9EBF2] text-brand-muted" : reasonTone(item.schregModGbnNm)
          }`}
        >
          {item.schregModGbnNm || "변동"}
        </span>
        <span className="text-[11px] text-brand-muted">신청 {fmtDate(item.schregModAplyDt)}</span>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-bold ${
              finished ? "bg-[#C4C8D6]" : avatarTone(item.stuno)
            }`}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <p
              className={`text-[13.5px] font-bold leading-snug truncate ${
                finished ? "text-[#8B8FA3]" : "text-brand-navy"
              }`}
            >
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

// 2026-09-07(14): "현황 요약 부분 사진처럼 해줘" 요청 — 팀에서 보여준 시안
// (아이콘+실시간 배지 헤더 / 사유별 분포 막대그래프+리스트 / 대기 중인 승인
// 단계 번호 리스트 / 반려 경고 박스+필터 버튼) 구조로 리디자인. 데이터는
// 전부 기존 계산 로직(reasonCounts/stageCounts/rejectedCount) 그대로 —
// 새로 지어내는 값은 없고 보여주는 형태만 바꿨다. "AI가 분석" 문구를 뺐던
// 원래 원칙(2026-09-02, 파일 상단 주석)도 그대로 유지.
function PieIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" {...props}>
      <path d="M10 2v8l6.9 4a8 8 0 1 1-6.9-12Z" fill="currentColor" />
      <path d="M12 2.3A8 8 0 0 1 17.9 10H10V2.3Z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}
function FolderIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5" {...props}>
      <path d="M2.5 5.5a1 1 0 0 1 1-1H8l1.5 2h7a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}
function ClockIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5" {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 6v4.2l2.8 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
// 2026-09-07(15): "이거 뭐냐"(경고 아이콘이 카드를 거의 다 채울 만큼 커지고
// 옆 텍스트는 세로 한 글자씩 찌그러진 버그) — 원인은 `className="w-4 h-4"
// {...props}` 순서였음. 호출부에서 <WarnIcon className="text-status-red
// flex-shrink-0" />처럼 className을 넘기면, 뒤에 스프레드된 props의
// className이 앞의 "w-4 h-4"를 통째로 덮어써서 크기 클래스가 사라졌었다
// (다른 아이콘들은 className을 안 넘겨받아서 안 드러났던 버그). className을
// 따로 받아서 기본 크기 클래스 뒤에 이어붙이는 방식으로 고침(덮어쓰기 대신
// 병합).
function WarnIcon({ className = "", ...rest }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={`w-4 h-4 ${className}`}
      {...rest}
    >
      <path d="M10 3.2 2.6 16.2a1 1 0 0 0 .87 1.5h13.06a1 1 0 0 0 .87-1.5L10 3.2Z" strokeLinejoin="round" />
      <path d="M10 8v3.3" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// 2026-09-07(21): "2번 사진이랑 똑같이" 요청으로 사유별 분포 막대/점 색을
// 사유 종류(휴학=amber/자퇴=red/복학=green)별로 다르게 칠하던 것에서 →
// 건수 순위(1등만 브랜드 블루, 나머지는 슬레이트 회색 톤) 기준으로 바꿨다.
// 사유가 몇 개든 색이 계속 늘어나지 않고, 가장 큰 비중이 뭔지만 한눈에
// 보이는 쪽으로 단순화. reasonCounts가 이미 건수 내림차순 정렬이라 인덱스만
// 넘기면 된다.
function rankColor(index) {
  if (index === 0) return "bg-brand-blue";
  if (index === 1) return "bg-slate-400";
  return "bg-slate-300";
}

// 2026-09-07(21): KPI 타일마다 숫자 옆 보조 텍스트를 "필요할 때만 배지처럼"
// 보이게 스타일을 나눔 — 전체 신청은 그냥 옅은 회색 텍스트, 처리 대기/반려는
// 옅은 색 배경의 배지, 완료는 흰 바탕에 얇은 테두리만 두른 중립 배지.
function kpiSubClass(style) {
  if (style === "blue") return "bg-brand-blue/10 text-brand-blueDark px-1.5 py-0.5 rounded-full font-bold";
  if (style === "red") return "bg-status-redBg text-status-red px-1.5 py-0.5 rounded-full font-bold";
  if (style === "neutral")
    return "bg-white border border-brand-border text-brand-navy px-1.5 py-0.5 rounded-full font-bold";
  return "text-brand-muted";
}

// 2026-09-07(19): "이 목업(EnhancedSummaryCard)에서 좌측 현황요약 부분만
// 디자인 적용해줘" 요청 — 팀에서 새로 보내준 목업은 보라색 카드 테마 대신
// 중립(슬레이트) 바탕에 상단 그라데이션 띠 + 옅은 슬레이트 통계 타일 +
// 절제된 포인트 컬러 조합을 쓰고 있었다. 그 톤 그대로 옮기되, 목업이 쓰던
// Font Awesome 아이콘은 새 의존성이라 추가하지 않고(코딩 규칙 — 아이콘 폰트
// 새로 안 넣기) 기존 인라인 SVG 아이콘(PieIcon/FolderIcon/ClockIcon/
// WarnIcon)을 그대로 재사용했다. 계산 로직(reasonCounts/stageCounts/
// rejectedCount/pendingCount/doneCount/totalPendingStages)과 반려 필터
// 토글 동작은 전부 그대로 — 바뀐 건 마크업/색상 등 표현 방식뿐이다. 이
// 패널 바깥(FilterPanel, 우측 카드 리스트, 헤더)은 이번 요청 범위 밖이라
// 손대지 않았다.
function SummaryPanel({ items, statusFilter, onToggleRejectedFilter }) {
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
  // 2026-09-07(17): "전체신청/처리대기/반려/완료 타일을 없애고 현황요약
  // 안으로 넣어달라" 요청 — 예전엔 StatusChangePage 본문 우측에 별도
  // grid-cols-4 타일로 떠 있었는데, 그 4개 값을 이 패널 헤더 바로 아래
  // 2x2 박스로 옮겨왔다. 계산 로직(isDone/isRejected)은 그대로 재사용해서
  // 우측 리스트의 개수와 항상 같은 값을 보여준다.
  const pendingCount = useMemo(() => items.filter((i) => !isDone(i) && !isRejected(i)).length, [items]);
  const doneCount = useMemo(() => items.filter(isDone).length, [items]);
  const totalPendingStages = stageCounts.reduce((sum, [, count]) => sum + count, 0);

  // 2026-09-07(21): "2번 사진이랑 똑같이" 요청 — 타일 테두리(border)를 아예
  // 없애고 옅은 브랜드 톤(brand-alt) 배경만 남겨서 카드 안에 더 자연스럽게
  // 녹아들게 함. 보조 텍스트도 4칸이 전부 배지였던 것에서 → 전체 신청만
  // 배지 없는 맨 텍스트, 완료는 흰 바탕 중립 배지로 톤을 낮췄다(반려처럼
  // "확인이 필요한" 항목만 색 배지로 강조).
  // 2026-09-07(23): "전체 신청 > 20건 없애주고 숫자만 나오게" 요청 — 전체
  // 신청 타일은 sub 자체를 없애서(null) 숫자 하나만 남김.
  const kpiTiles = [
    { label: "전체 신청", value: items.length, sub: null, subStyle: "plain" },
    { label: "처리 대기", value: pendingCount, sub: "대기중", subStyle: "blue" },
    { label: "반려", value: rejectedCount, sub: "확인요망", subStyle: "red" },
    { label: "완료", value: doneCount, sub: "승인완료", subStyle: "neutral" },
  ];

  return (
    <div className="bg-white rounded-[20px] border border-brand-border overflow-hidden">
      {/* 2026-09-07(28): "위에 파란줄 없애줘" 요청으로 상단 그라데이션 띠
          제거. */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          {/* 2026-09-07(22): "현황요약 글씨 볼드체 해주고" — 이미 font-bold였는데
              13px라 두께가 잘 안 보였던 것 같아 14px + font-extrabold로 더 확실히. */}
          <h3 className="text-[14px] font-extrabold text-brand-navy flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-lg bg-slate-100 text-brand-blue flex items-center justify-center flex-shrink-0">
              <PieIcon />
            </span>
            현황 요약
          </h3>
          {/* 2026-09-07(14): "실시간" 배지 — 접속 여부를 실측하는 건 아니고,
              이 목록 자체가 background.js의 1분 주기 폴링 결과를 그대로 보여준다는
              뜻의 라벨(장식이 아니라 실제 동작 방식과 일치). */}
          <span className="text-[10.5px] font-bold text-status-green bg-status-greenBg px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse" /> 실시간
          </span>
        </div>

        {/* 2026-09-07(17): 우측에 따로 떠 있던 4개 통계 타일(전체 신청/처리
            대기/반려/완료)을 이 자리(헤더 바로 아래)로 옮김.
            2026-09-07(21): "2번 사진이랑 똑같이" 요청 — 흰 배경+테두리 카드
            였던 것을 테두리 없는 옅은 브랜드 톤 배경으로, 숫자는 전부 navy
            하나로 통일하고 보조 텍스트만 상태별로 배지 유무/색을 다르게. */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {kpiTiles.map((tile) => (
            <div key={tile.label} className="bg-brand-alt rounded-xl px-3 py-2.5">
              <p className="text-[10.5px] text-brand-muted font-semibold">{tile.label}</p>
              {/* 2026-09-07(24): "숫자 글씨체 총 OO건 이거랑 통일해줘" — 바로
                  아래 "사유별 분포"의 "총 {N}건" 캡션(별도 font-weight 없이
                  기본 굵기)과 같은 글씨체로 맞추려고 font-bold를 뺐다(기본
                  굵기, 크기/색만 유지). 배지(대기중/확인요망/승인완료)는
                  justify-between으로 타일 우측 끝에 붙게 정렬. */}
              {/* 2026-09-07(25): "숫자 볼드체 해줘" — 방금(24) 뺐던 font-bold를
                  다시 넣음(글씨체 통일 요청의 핵심은 폰트 패밀리였지, 굵기를
                  없애자는 뜻은 아니었던 것으로 보임). */}
              <div className="flex items-baseline justify-between gap-1.5 mt-1">
                <span className="text-xl font-bold text-brand-navy">{tile.value}</span>
                {tile.sub && (
                  <span className={`text-[10px] flex-shrink-0 ${kpiSubClass(tile.subStyle)}`}>{tile.sub}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 text-[12px]">
          {/* 사유별 분포 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-brand-muted font-semibold flex items-center gap-1.5">
                <FolderIcon /> 사유별 분포
              </p>
              <p className="text-brand-muted">총 {items.length}건</p>
            </div>
            {reasonCounts.length === 0 ? (
              <p className="text-brand-muted">데이터 없음</p>
            ) : (
              <>
                <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                  {reasonCounts.map(([label, count], i) => (
                    <span
                      key={label}
                      className={rankColor(i)}
                      style={{ width: `${(count / items.length) * 100}%` }}
                    />
                  ))}
                </div>
                <ul className="flex flex-col gap-1.5 mt-2.5">
                  {reasonCounts.map(([label, count], i) => (
                    <li key={label} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rankColor(i)}`} />
                      <span className="text-brand-navy font-medium flex-1 truncate">{label}</span>
                      <span className="text-brand-muted">{Math.round((count / items.length) * 100)}%</span>
                      <span className="text-brand-navy font-bold bg-white border border-brand-border rounded-full px-2 py-0.5 min-w-[44px] text-center">
                        {count}건
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* 대기 중인 승인 단계 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-brand-muted font-semibold flex items-center gap-1.5">
                <ClockIcon /> 대기 중인 승인 단계
              </p>
              {/* 2026-09-07(18): 처음엔 진한 단색+흰글씨였다가, 2026-09-07(21)
                  "2번 사진이랑 똑같이" 요청으로 중립(흰 배경+테두리)으로
                  낮췄고, 2026-09-07(22) "색상 넣어줘"로 진한 주황 배지로
                  바꿨었는데, 2026-09-07(24) "기존 조치필요 색상처럼 빨간색으로"
                  요청 — 아래 "조치필요" 배지와 완전히 같은 색(bg-status-redBg
                  + text-status-red)으로 맞춤. */}
              {totalPendingStages > 0 && (
                <span className="text-[10.5px] font-bold text-status-red bg-status-redBg px-2 py-0.5 rounded-full flex-shrink-0">
                  {totalPendingStages}건 처리요망
                </span>
              )}
            </div>
            {stageCounts.length === 0 ? (
              <p className="text-brand-muted">대기 중인 항목 없음</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {stageCounts.map(([label, count], i) => (
                  <li key={label} className="flex items-center gap-2">
                    {/* 2026-09-07(21): 사각 슬레이트 배지 → 원형(rounded-full)
                        회색 배지로. 건수 텍스트도 브랜드 블루 강조에서
                        navy로 낮춰서 전체 톤을 중립에 맞춤. */}
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-brand-navy text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-brand-navy font-medium flex-1 truncate">{label}</span>
                    <span className="text-brand-navy font-bold">{count}건</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 반려 — 실제로 조치가 필요한 항목이라 강조는 하되, 이번
              리디자인에서는 카드 전체를 빨간 배경으로 채우던 것 대신 중립
              슬레이트 박스 안에서 텍스트/배지만 빨간색으로 남겨 톤을
              맞췄다. "반려 내역 필터링" 버튼(FilterPanel의 진행 상태
              필터를 "반려"로 바꿔주는 것뿐, 새 조회 기능은 아님) 토글
              동작은 그대로. */}
          {rejectedCount > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-1.5">
                <WarnIcon className="text-status-red flex-shrink-0" />
                <p className="text-status-red font-bold">반려 신청 {rejectedCount}건</p>
                {/* 2026-09-07(21): "2번 사진이랑 똑같이" — 진한 단색 배지에서
                    옅은 배경(status-redBg) + 빨간 텍스트로 다시 낮춤. */}
                <span className="text-[10px] font-bold text-status-red bg-status-redBg px-1.5 py-0.5 rounded flex-shrink-0">
                  조치필요
                </span>
              </div>
              <p className="text-brand-muted text-[11px] mt-1 mb-2.5">승인단계 참고 및 보완 안내 필요</p>
              {/* 2026-09-07(17): "필터링 누르면 그 버튼이 전체보기로 바뀌게"
                  요청 — 지금 필터가 이미 "반려"면 버튼을 "전체보기 →"로 바꾸고
                  누르면 다시 statusFilter를 "all"로 되돌리는 토글 버튼으로 동작.
                  2026-09-07(22): "반려내역 필터링 버튼 조치필요 배경색상으로
                  넣어주고 누르면 전체보기 흰색 버튼으로" 요청 — 바로 위
                  "조치필요" 배지와 같은 배경(status-redBg)+텍스트(status-red)
                  색을 기본 상태(아직 필터링 전) 버튼에 쓰고, 필터링된 상태
                  (전체보기)에서는 흰 배경으로 낮춰서 두 상태가 색으로도
                  구분되게 함. */}
              <button
                onClick={onToggleRejectedFilter}
                className={`w-full text-center text-[12px] font-bold rounded-lg py-1.5 border transition ${
                  statusFilter === "rejected"
                    ? "bg-white text-status-red border-status-red/30 hover:bg-status-redBg"
                    : "bg-status-redBg text-status-red border-status-red/20 hover:bg-status-red/15"
                }`}
              >
                {statusFilter === "rejected" ? "전체보기 →" : "반려 내역 필터링 →"}
              </button>
            </div>
          )}
        </div>
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

  // 2026-09-07(17): 여기 있던 pendingCount/doneCount/rejectedCount(처리
  // 대기/완료/반려 집계)는 우측 4개 타일 전용이었는데 그 타일을 없애면서
  // 이 컴포넌트 레벨에선 더 이상 안 씀 — 같은 계산은 SummaryPanel이 자기
  // items prop으로 직접 다시 하고 있음(중복 계산이지만 컴포넌트 간 props로
  // 안 넘겨도 되게 하는 쪽을 택함).
  const selected = items.find((it) => it.id === selectedId) || null;

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
            <SummaryPanel
              items={items}
              statusFilter={statusFilter}
              onToggleRejectedFilter={() => setStatusFilter((f) => (f === "rejected" ? "all" : "rejected"))}
            />
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

          {/* 오른쪽: 카드 리스트
              2026-09-07(17): "전체신청/처리대기/반려/완료 타일 없애고 현황요약
              안으로" 요청 — 여기 있던 4개 통계 타일(StatTile) 그리드를
              없애고 왼쪽 SummaryPanel 헤더 아래 2x2 박스로 옮겼다.
              2026-09-07(28): "전체신청 없애줘" 요청 — 리스트 위에 있던
              "전체 신청 / N건" 제목 줄 자체를 없앴다(listTitle 변수는 다른
              곳에서 안 쓰여서 죽은 코드지만, 필터 상태에 따라 문구가 바뀌는
              로직 자체는 나중에 다시 쓸 수도 있어 남겨둠 — eslint 경고 없이
              쓰려면 지워도 무방). */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-5">
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
