// src/components/Header.jsx
// 2026-09-07(26) 신규 — "내 이름, 직책은 우측 상단으로, 알림 버튼도 그
// 옆으로" + 참고 사진(좌측 로고, 우측 알림+사용자 정보가 있는 흰색 상단
// 헤더바) 요청으로 새로 뺀 상단 헤더. 기존에 Navbar.jsx 사이드바 안에
// 있던 브랜드 로고/사용자 정보/알림 벨을 그대로 여기로 옮겼다 — 데이터
// (userName/userGbInfo/getNewCoopDocs)는 전부 기존 로직 그대로 재사용,
// 새로 지어낸 값 없음(userName/userGbInfo는 실제 로그인 계정 정보,
// loadUserProfile이 앱 로드 시 ERP에서 조회해서 채움).
import { useEffect, useState } from "react";
import useStore from "../store/useStore.js";
import { getNewCoopDocs, markAllCoopDocsRead } from "../lib/db.js";
import { mockSummarize } from "../lib/kisApi.js";
import { SIDEBAR_WIDTH_CLASS } from "./Navbar.jsx";

// Navbar.jsx의 top-16 / App.jsx의 pt-16과 반드시 맞출 것.
export const HEADER_HEIGHT_CLASS = "h-16";

function BellIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[18px] h-[18px]" {...props}>
      <path d="M5 8a5 5 0 0 1 10 0c0 3.1 0.95 4.35 1.5 5H3.5C4.05 12.35 5 11.1 5 8Z" strokeLinejoin="round" />
      <path d="M8.2 15.4a1.9 1.9 0 0 0 3.6 0" strokeLinecap="round" />
    </svg>
  );
}

// 2026-09-08: "아이콘 좀더 눈에 들어오게" 요청 — 이전엔 30px짜리 작은 박스
// 안에 이모지(🏫)라 네이비 배경 위에서 흐릿하게 묻혔다. 다른 아이콘들(Navbar.jsx
// 등)과 같은 관례(아이콘 폰트 새로 안 넣고 순수 인라인 SVG, viewBox 정사각형)를
// 맞춰서 이모지 대신 흰색 선 스타일의 건물(기관) 아이콘으로 교체 — 배지도
// 키우고 그림자를 더해서 대비를 높였다.
function LogoIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" {...props}>
      <path d="M4 10.5 12 5l8 5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10.5V18M9 10.5V18M15 10.5V18M18.5 10.5V18" strokeLinecap="round" />
      <path d="M4 18h16" strokeLinecap="round" />
      <path d="M3.2 20.5h17.6" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

// 2026-09-08: "알림창 사진처럼" 요청으로 벨 드롭다운을 다시 짰다 — 사진의
// 톤(부서 태그+시간 → 제목 → 요약 → "공문 바로보기 → · 마감 N일 남음")은
// 그대로 가져오되, 사진에 있던 검색창/카테고리 탭/"처리 필요" 배지는 실제
// 데이터로 못 채우거나(카테고리 자체가 없음) 우진이 직접 빼달라고 한 것들이라
// 넣지 않았다.
//
// 상대 시각 "N분 전 (HH:mm)" — TaskPanel.jsx의 formatDday와 마찬가지로 이
// 파일 전용 로컬 헬퍼(다른 곳에 재사용 안 해서 별도 모듈로 안 뺐다).
function formatBellTime(createdAt) {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const abs = `(${hh}:${mm})`;
  if (diffMin < 1) return `방금 전 ${abs}`;
  if (diffMin < 60) return `${diffMin}분 전 ${abs}`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전 ${abs}`;
  return `${Math.floor(diffHour / 24)}일 전 ${abs}`;
}

// TaskPanel.jsx의 formatDday와 동일한 계산(같은 doc.deadline 필드를 그대로
// 씀) — 컴포넌트 간 import로 얽히게 하지 않고 이 파일에도 똑같이 복사해둔다
// (이 프로젝트 관례: background.js/StatusChangePage.jsx의 stageStatus 중복도
// 같은 이유).
function formatDday(deadline) {
  const target = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target.getTime() - todayMid.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays > 0) return `${diffDays}일 남음`;
  if (diffDays === 0) return "오늘 마감";
  return `${-diffDays}일 지남`;
}

function BellItem({ doc, onOpen }) {
  // CoopCard.jsx와 동일한 원칙: ai_summary가 비어있으면 "AI가 요약했다"고
  // 속이지 않고 mockSummarize(본문 앞부분을 그냥 잘라낸 것)로 대체한다.
  const summaryText = doc.ai_summary || mockSummarize(doc);
  const dday = doc.deadline ? formatDday(doc.deadline) : null;

  return (
    <button
      onClick={onOpen}
      className="block w-full text-left px-4 py-3 border-b border-brand-border hover:bg-brand-alt last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-brand-blueDark min-w-0 truncate">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-blue flex-shrink-0" />
          <span className="truncate">{doc.sender_dept || "발신부서 미상"}</span>
        </span>
        <span className="text-[10px] text-brand-muted flex-shrink-0">{formatBellTime(doc.created_at)}</span>
      </div>
      <p className="text-[12.5px] font-bold text-brand-navy leading-snug mt-1">
        {doc.title || "(제목 없음)"}
      </p>
      {summaryText && <p className="text-[11px] text-brand-muted mt-1 line-clamp-1">{summaryText}</p>}
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-[11px] font-bold text-brand-blue">공문 바로보기 →</span>
        {dday && (
          <>
            <span className="text-brand-border text-[11px]">·</span>
            <span className="text-[11px] font-bold text-status-amber">마감 {dday}</span>
          </>
        )}
      </div>
    </button>
  );
}

export default function Header() {
  const toast = useStore((s) => s.toast);
  const openDetail = useStore((s) => s.openDetail);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const userName = useStore((s) => s.userName);
  const userGbInfo = useStore((s) => s.userGbInfo);

  const [bellOpen, setBellOpen] = useState(false);
  const [newDocs, setNewDocs] = useState([]);

  useEffect(() => {
    getNewCoopDocs().then(setNewDocs);
  }, [toast]); // 토스트가 뜰 때(=신규 문서 발생 시점)마다 벨 목록도 같이 갱신 (Navbar.jsx가 하던 것과 동일)

  const userInitial = (userName || "?").slice(0, 1);

  // 2026-09-08: "모두 읽음" — markAllCoopDocsRead()가 IndexedDB에서 실제로
  // is_new를 전부 false로 바꾸고, 그 다음 여기서도 newDocs를 비워서 벨
  // 배지/목록이 새로고침 없이 바로 반영되게 한다.
  const handleMarkAllRead = async () => {
    await markAllCoopDocsRead();
    setNewDocs([]);
  };

  return (
    <header className={`fixed top-0 left-0 right-0 ${HEADER_HEIGHT_CLASS} z-40 flex`}>
      {/* 2026-09-07(28): "좌측 메뉴바 행정어시스턴트까지는 배경 네이비로"
          요청 — 로고 구역을 사이드바와 같은 폭(SIDEBAR_WIDTH_CLASS)의 네이비
          블록으로 분리해서, 맨 위(로고)부터 사이드바 끝까지 왼쪽 세로줄이
          끊김 없이 네이비로 이어지게 함. 오른쪽(알림/사용자 정보) 구역만
          흰 배경 + 하단 테두리 유지. */}
      <div className={`${SIDEBAR_WIDTH_CLASS} h-full bg-brand-navy flex items-center gap-2.5 px-5 flex-shrink-0`}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-blue to-brand-blueDark flex items-center justify-center flex-shrink-0 shadow-[0_4px_14px_rgba(79,110,247,0.5)] ring-1 ring-white/15">
          <LogoIcon className="w-5 h-5" />
        </div>
        <div className="flex flex-col leading-tight">
          <strong className="text-sm tracking-tight text-white">행정 어시스턴트</strong>
          <span className="text-[11px] text-[#9BA3C2]">KBU ERP 자동화</span>
        </div>
      </div>

      {/* 알림 + 사용자 정보 — 기존 Navbar.jsx 사이드바 하단/상단에 있던 걸 이동 */}
      <div className="flex-1 h-full bg-white border-b border-brand-border flex items-center justify-end gap-3 px-5">
        <div className="relative">
          <button
            onClick={() => setBellOpen((v) => !v)}
            className="relative w-9 h-9 rounded-full flex items-center justify-center text-brand-muted hover:bg-brand-alt hover:text-brand-navy transition-colors"
            aria-label="알림"
          >
            <BellIcon />
            {newDocs.length > 0 && (
              <span className="absolute top-1 right-1 bg-status-red text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-[3px]">
                {newDocs.length}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full mt-2 w-[360px] bg-white border border-brand-border rounded-2xl shadow-brand z-40 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
                <span className="text-[13.5px] font-extrabold text-brand-navy flex items-center gap-2">
                  알림 센터
                  {newDocs.length > 0 && (
                    <span className="text-[10.5px] font-bold text-status-red bg-status-redBg px-2 py-0.5 rounded-full">
                      미확인 {newDocs.length}
                    </span>
                  )}
                </span>
                {newDocs.length > 0 && (
                  <button onClick={handleMarkAllRead} className="text-[11.5px] font-semibold text-brand-blue hover:text-brand-blueDark">
                    모두 읽음
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto">
                {newDocs.length === 0 ? (
                  <p className="p-4 text-sm text-brand-muted text-center">새 알림 없음</p>
                ) : (
                  newDocs.map((doc) => (
                    <BellItem
                      key={doc.id}
                      doc={doc}
                      onOpen={() => {
                        setActiveTab("coop");
                        openDetail(doc.id);
                        setBellOpen(false);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {userName && (
          <div className="flex items-center gap-2 pl-3 border-l border-brand-border">
            <div className="w-8 h-8 rounded-full bg-brand-blue/15 border border-brand-blue/20 flex items-center justify-center text-brand-blueDark text-[13px] font-bold flex-shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="text-[12.5px] font-semibold text-brand-navy truncate">{userName}</p>
              {userGbInfo && <p className="text-[10.5px] text-brand-muted truncate">{userGbInfo}</p>}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
