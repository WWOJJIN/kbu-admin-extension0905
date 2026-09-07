import { useEffect } from "react";
import Navbar from "./components/Navbar.jsx";
import BriefingPage from "./components/BriefingPage.jsx";
// 2026-09-07: "협조문이랑 캘린더페이지랑 합치자" 요청으로 CalendarPage.jsx는
// 더 이상 별도 탭으로 라우팅하지 않는다(CoopPage.jsx가 흡수 — 그 파일 상단
// 주석 참고). CalendarPage.jsx/CalendarGrid.jsx 파일 자체는 남아있고,
// CalendarGrid는 CoopPage.jsx가 계속 재사용한다.
import CoopPage from "./components/CoopPage.jsx";
import ChatPage from "./components/ChatPage.jsx";
import SettingsPage from "./components/SettingsPage.jsx";
import SettingsDevPage from "./components/SettingsDevPage.jsx";
import ApprovalStatusPage from "./components/ApprovalStatusPage.jsx";
import StatusChangePage from "./components/StatusChangePage.jsx";
import CoopDetailModal from "./components/CoopDetailModal.jsx";
import useStore from "./store/useStore.js";
import { initDB, getNewCoopDocs } from "./lib/db.js";

const PAGES = {
  briefing: BriefingPage,
  coop: CoopPage,
  approval: ApprovalStatusPage,
  status: StatusChangePage,
  chat: ChatPage,
  settings: SettingsPage,
  settingsDev: SettingsDevPage,
};

const NEW_DOC_POLL_MS = 15000;

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const showToast = useStore((s) => s.showToast);
  const loadCoopDocs = useStore((s) => s.loadCoopDocs);
  const backfillMissingDrafters = useStore((s) => s.backfillMissingDrafters);
  const pruneOutOfScopeCoopDocs = useStore((s) => s.pruneOutOfScopeCoopDocs);
  const loadUserProfile = useStore((s) => s.loadUserProfile);
  const selectedDocId = useStore((s) => s.selectedDocId);
  const Page = PAGES[activeTab] ?? CoopPage;

  useEffect(() => {
    initDB();

    // 기안자 필드 추가 전에 저장된 옛날 문서들 일괄 보정 + 부서 범위 밖 문서
    // 정리(2026-08-21 이전엔 전사문서열람 범위로 캐시됐었음) — 앱 로드 시 1회.
    // 2026-08-22(16): loadUserProfile()을 이 체인과 병렬로 따로 실행했었는데,
    // 실사용 중 "로그인은 돼있는데 세션 만료로 뜬다" 리포트 발생 — 원인 후보로
    // 앱 로드 시점에 여러 API 호출이 한꺼번에 몰리는 것(React 탭 쪽만 해도
    // backfillMissingDrafters/pruneOutOfScopeCoopDocs가 각각 fetchCoopDocListAllDepts
    // 를 부르고, 그 안에서 소속 부서 수만큼 순차 요청이 또 나가는데, 여기에
    // loadUserProfile까지 동시에 겹치고 background.js 서비스워커 폴링까지
    // 겹칠 수 있음)이 의심돼서, 최소한 이 탭 안에서는 전부 순차 체인으로
    // 묶어 동시 요청을 줄임(완전한 해결인지는 미확인 — ERP 쪽 부하/불안정
    // 가능성이 커서 지켜봐야 함).
    loadCoopDocs()
      .then(() => backfillMissingDrafters())
      .then(() => pruneOutOfScopeCoopDocs())
      .then(() => loadUserProfile());

    // background.js(별도 service worker 컨텍스트)가 IndexedDB에 새 문서를 써도
    // 이 React 앱에 직접 알려줄 방법이 없어서, 주기적으로 새 문서 유무를 확인해
    // 토스트를 띄운다. TODO: BroadcastChannel로 background.js가 직접 알려주는
    // 방식으로 개선 가능.
    let lastKnownNewIds = new Set();
    let cancelled = false;

    const checkNew = async () => {
      const newDocs = await getNewCoopDocs();
      if (cancelled) return;
      const freshOnes = newDocs.filter((d) => !lastKnownNewIds.has(d.id));
      if (freshOnes.length > 0 && lastKnownNewIds.size > 0) {
        // 최초 로드 시(lastKnownNewIds가 비어있을 때)는 토스트 안 띄움 —
        // 안 그러면 앱 켤 때마다 기존 미확인 문서들에 대해 토스트가 뜸.
        showToast(`새 협조문 ${freshOnes.length}건이 도착했습니다.`);
      }
      lastKnownNewIds = new Set(newDocs.map((d) => d.id));
    };

    checkNew();
    const interval = setInterval(checkNew, NEW_DOC_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [showToast, loadCoopDocs, backfillMissingDrafters, pruneOutOfScopeCoopDocs, loadUserProfile]);

  return (
    <div className="min-h-screen bg-brand-alt">
      <Navbar />
      <div className="ml-72 min-h-screen">
        <Page />
      </div>
      {selectedDocId && <CoopDetailModal docId={selectedDocId} />}
    </div>
  );
}
