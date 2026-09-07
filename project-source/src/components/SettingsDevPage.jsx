// src/components/SettingsDevPage.jsx
// "개발자 설정" 탭. 2026-09-07 신규 추가 — "설정 탭을 사용자용/개발자용으로
// 나눠줘(메뉴바에서)" 요청으로 기존 SettingsPage.jsx 안에 섞여 있던
// 개발/테스트 전용 도구를 이 탭으로 분리했다. 옮긴 것들:
//   - 기존 문서 일괄 재요약 / 재요약 초기화 (원래부터 "개발/테스트용"이라고
//     주석·UI에 명시돼 있던 기능, AiSummaryToggleSection 안에 있었음)
//   - 협조문 폴링 진단 로그 (PollDiagnosticsSection)
// 사용자 설정(SettingsPage.jsx)엔 평소에 계속 쓰는 on/off 스위치·기간 설정·
// 탭 켜고끄기·부서코드만 남겼다.

import { useEffect, useMemo, useState } from "react";
import useStore from "../store/useStore.js";
import { getAiSummaryEnabled } from "../lib/db.js";

const BULK_RESUMMARIZE_AGE_OPTIONS = [1, 3, 7, 14, 30, 0]; // 0 = 제한 없음

// 2026-09-05 추가(SettingsPage.jsx에서 이식): 기존 문서 일괄 재요약 +
// 재요약 초기화. AI 파싱은 "처음 감지된 순간" 단 한 번만 시도되고 재시도가
// 없어서, 그 시점에 설정이 꺼져있었거나 프록시가 아직 준비 안 됐던 문서는
// 영구히 "본문 발췌"로만 남는 문제가 실사용 중 발견됨(345건 중 다수). 자동
// 실행하면 안 되고(실제 비용 발생), 사용자가 건수를 보고 명시적으로 눌러야
// 실행됨. AI 요약 자체가 꺼져있으면(설정 탭에서) 여기도 같이 비활성화된다.
function AiSummaryDevToolsSection() {
  const [enabled, setEnabled] = useState(null);
  const [missingCount, setMissingCount] = useState(null);
  // 일괄 재요약 전용 기간 — 평소 새 문서용 AI_SUMMARY 기간(사용자 설정 쪽
  // maxAgeDays)과는 별개로, 이 한 번의 정리 작업만 더 좁게 조절할 수 있게
  // 분리함. 기본값은 7일로 시작 — 이미 쌓인 백로그는 대부분 최근 문서라
  // (신규 도입 초기), 전역 30일 설정으로는 거의 안 걸러지는 걸 확인해서 더
  // 보수적인 기본값을 씀.
  const [bulkAgeDays, setBulkAgeDays] = useState(7);

  const getMissingAiSummaryCandidates = useStore((s) => s.getMissingAiSummaryCandidates);
  const bulkResummarizeMissingAi = useStore((s) => s.bulkResummarizeMissingAi);
  const resummarizeProgress = useStore((s) => s.resummarizeProgress);
  // "재요약 초기화(테스트용)" 버튼 — coopDocs를 구독해서 bulkAgeDays 기준으로
  // "이미 AI 요약이 있는" 문서 수를 미리보기로 계산.(useStore.js의
  // resetAiSummaryForAge 안 필터와 동일한 로직을 화면 표시용으로 한 번 더
  // 계산 — 액션 자체는 count만 리턴하지 않고 실행까지 하므로 분리.)
  const coopDocs = useStore((s) => s.coopDocs);
  const resetAiSummaryForAge = useStore((s) => s.resetAiSummaryForAge);
  const resettableCount = useMemo(() => {
    const now = Date.now();
    return coopDocs.filter((d) => {
      if (!d.ai_summary) return false;
      if (!bulkAgeDays || bulkAgeDays <= 0) return true;
      if (!d.date) return true;
      const docTime = new Date(`${d.date}T00:00:00`).getTime();
      if (Number.isNaN(docTime)) return true;
      return now - docTime <= bulkAgeDays * 24 * 60 * 60 * 1000;
    }).length;
  }, [coopDocs, bulkAgeDays]);

  useEffect(() => {
    getAiSummaryEnabled().then(setEnabled);
  }, []);

  // bulkAgeDays가 바뀔 때마다 그 기준으로 대상 건수를 다시 센다.
  useEffect(() => {
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  }, [bulkAgeDays, getMissingAiSummaryCandidates]);

  if (enabled === null) return null;

  const handleBulkResummarize = async () => {
    if (!missingCount) return;
    const ok = window.confirm(
      `최근 ${bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} 문서 중 AI 요약이 없는 ${missingCount}건을 지금 요약할까요?\n` +
        `문서 수만큼 Claude API 호출이 발생해서 비용이 듭니다. 시간이 좀 걸릴 수 있어요.`
    );
    if (!ok) return;
    await bulkResummarizeMissingAi({ ageDaysOverride: bulkAgeDays });
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  };

  // 개발/테스트 전용 — 방금 재요약된 내용을 지워서 "일괄 재요약" 버튼을
  // 반복 테스트할 수 있게 함. Claude API를 안 부르는 로컬 작업이라 비용
  // 경고는 없지만, 되돌릴 수 없어서 confirm은 그대로 둠.
  const handleResetAiSummary = async () => {
    if (!resettableCount) return;
    const ok = window.confirm(
      `최근 ${bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} 문서 중 AI 요약이 있는 ${resettableCount}건을 초기화(삭제)할까요?\n` +
        `개발/테스트용 기능이에요. Claude API를 호출하지 않아 비용은 안 들지만, 초기화하면 되돌릴 수 없어요.`
    );
    if (!ok) return;
    await resetAiSummaryForAge({ ageDaysOverride: bulkAgeDays });
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-brand-navy mb-1">AI 요약 재처리 도구</h3>
      {!enabled && (
        <p className="text-xs text-amber-600 mb-2">
          사용자 설정에서 "AI 요약(Claude API) 사용"이 꺼져있어요. 아래 도구는 그 스위치를 다시 켜야 쓸 수 있어요.
        </p>
      )}
      {/* 기존 문서 일괄 재요약 */}
      <div className={`border border-brand-border rounded-lg px-3.5 py-2.5 ${enabled ? "" : "opacity-50"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="pr-3">
            <p className="text-sm text-brand-navy">기존 문서 일괄 재요약</p>
            <p className="text-xs text-brand-muted mt-0.5">
              AI 요약 없이 저장된(카드에 "본문 발췌"로 뜨는) 문서를 지금 한꺼번에 요약해요. 문서 수만큼 Claude
              API 호출이 발생하니, 아래에서 최근 며칠치만 대상으로 할지 먼저 좁혀서 비용을 조절하세요. 날짜를
              모르는 문서는 비용 안전을 위해 대상에서 자동 제외돼요.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 mt-2.5">
          <select
            value={bulkAgeDays}
            onChange={(e) => setBulkAgeDays(Number(e.target.value))}
            disabled={!enabled || !!resummarizeProgress}
            className="border border-brand-border rounded px-1.5 py-1 text-xs bg-white"
          >
            {BULK_RESUMMARIZE_AGE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                최근 {d === 0 ? "전체 기간" : `${d}일`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleBulkResummarize}
            disabled={!enabled || !missingCount || !!resummarizeProgress}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-brand-blue text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resummarizeProgress ? "처리 중…" : `${missingCount ?? "-"}건 요약하기`}
          </button>
        </div>
        {resummarizeProgress && (
          <p className="text-xs text-brand-muted mt-2">
            진행 중: {resummarizeProgress.done}/{resummarizeProgress.total}건
            {resummarizeProgress.failed > 0 ? ` (실패 ${resummarizeProgress.failed}건)` : ""}
          </p>
        )}
      </div>

      {/* 재요약 초기화 */}
      <div className={`mt-2 border border-amber-200 bg-amber-50 rounded-lg px-3.5 py-2.5 ${enabled ? "" : "opacity-50"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="pr-3">
            <p className="text-sm text-amber-900">
              재요약 초기화 <span className="font-normal text-amber-700">(개발/테스트용)</span>
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              위에서 고른 기간 기준으로, 이미 AI 요약이 있는 문서의 요약만 지워서 재요약 전 상태로 되돌려요.
              Claude API 호출 없이 로컬에서만 지워져서 비용은 안 들지만, 초기화하면 되돌릴 수 없어요.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-2.5">
          <button
            type="button"
            onClick={handleResetAiSummary}
            disabled={!enabled || !resettableCount || !!resummarizeProgress}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            최근 {bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} · {resettableCount ?? "-"}건 초기화
          </button>
        </div>
      </div>
    </div>
  );
}

// 2026-09-02 추가(SettingsPage.jsx에서 이식): "세션 만료 알림이 자꾸 뜬다"는
// 리포트가 반복될 때마다 chrome://extensions에서 서비스워커 콘솔을 직접 열어
// chrome.storage.local의 pollLog를 확인해야 했음 — 매번 그러기 번거로우니
// 여기서 바로 최근 폴링 기록(성공/실패, 세션만료 추정 여부, ERP가 실제로 준
// 응답 일부)을 볼 수 있게 노출한다. 이 페이지 자체가 확장 오리진
// (chrome-extension://.../dist/index.html)이라 chrome.storage 접근 가능.
function PollDiagnosticsSection() {
  const [log, setLog] = useState(null);
  const [streak, setStreak] = useState(0);

  const refresh = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(["pollLog", "coopPollFailStreak"], (res) => {
      setLog([...(res.pollLog || [])].slice(-15).reverse());
      setStreak(res.coopPollFailStreak || 0);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-brand-navy">협조문 폴링 진단 로그</h3>
        <button onClick={refresh} className="text-xs text-brand-blue hover:underline">
          새로고침
        </button>
      </div>
      <p className="text-xs text-brand-muted mb-3">
        "ERP 로그인 세션 만료" 알림이 실제 로그아웃 때문인지, 아니면 오탐인지 확인할 때 참고하세요.
        실패 항목의 응답 스니펫에 그 순간 ERP가 실제로 준 응답이 그대로 남아있어요.
        {streak > 0 && <span className="text-red-500"> 현재 연속 실패 {streak}회 (2회부터 알림 발송).</span>}
      </p>
      {log === null ? (
        <p className="text-xs text-brand-muted">불러오는 중...</p>
      ) : log.length === 0 ? (
        <p className="text-xs text-brand-muted">아직 기록된 폴링 로그가 없어요. (확장 설치/업데이트 직후일 수 있어요.)</p>
      ) : (
        <div className="border border-brand-border rounded-lg divide-y divide-brand-border max-h-80 overflow-y-auto">
          {log.map((entry, i) => (
            <div key={i} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={entry.ok ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                  {entry.ok ? "성공" : "실패"}
                </span>
                <span className="text-brand-muted">{new Date(entry.ts).toLocaleString("ko-KR")}</span>
                {entry.sessionExpired && (
                  <span className="text-red-500 bg-red-50 rounded px-1.5 py-0.5">세션만료 추정</span>
                )}
                {entry.ok && <span className="text-brand-muted">{entry.count}건</span>}
              </div>
              {entry.error && <p className="text-brand-muted mt-1 break-words">{entry.error}</p>}
              {entry.responseSnippet && (
                <pre className="mt-1 bg-brand-alt rounded px-2 py-1.5 whitespace-pre-wrap break-all text-[11px] text-brand-muted">
                  {entry.responseSnippet}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsDevPage() {
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-brand-navy mb-1">개발자 설정</h2>
      <p className="text-sm text-brand-muted mb-2">
        디버깅/테스트용 도구예요. 평소 쓰는 설정은 "사용자 설정" 탭에 있어요.
      </p>

      <AiSummaryDevToolsSection />
      <PollDiagnosticsSection />
    </div>
  );
}
