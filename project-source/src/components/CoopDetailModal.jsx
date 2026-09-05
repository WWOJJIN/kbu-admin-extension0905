// src/components/CoopDetailModal.jsx
// 원문 팝업 (공통 컴포넌트, 협조문 탭/문서함 탭 공용 — UI 규칙).
// 팝업 구조: 헤더 → AI요약 바(파란 배경) → ERP 원문 재현 영역 → 하단 버튼.

import useStore from "../store/useStore.js";
import { getCoopDocListUrl } from "../lib/kisApi.js";

// raw_html 쪽은 kisApi.js의 linkifyHtml이 저장 시점에 처리해주지만, raw_text는
// (표/구조가 없는 순수 텍스트라 dangerouslySetInnerHTML을 안 씀) 렌더링할 때
// URL을 찾아서 클릭 가능한 <a>로 바꿔줘야 함. whitespace-pre-line으로 줄바꿈은
// 그대로 유지되니까 문자열을 텍스트/링크 조각 배열로 쪼개서 React 엘리먼트로
// 렌더링 (2026-08-22, "구글드라이브 링크 클릭 안 됨" 피드백 반영).
const URL_PATTERN = /(https?:\/\/[^\s<>"')]+)/g;
const URL_TRAILING_PUNCT = /[.,;:)\]}]+$/;

function Linkify({ text }) {
  if (!text) return null;
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) => {
    if (!/^https?:\/\//.test(part)) return part;
    const trailMatch = part.match(URL_TRAILING_PUNCT);
    const trail = trailMatch ? trailMatch[0] : "";
    const url = trail ? part.slice(0, -trail.length) : part;
    return (
      <span key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-blue underline break-all"
        >
          {url}
        </a>
        {trail}
      </span>
    );
  });
}

// raw_text는 구조 태그가 없는 순수 텍스트라 "1) ~~~ 2) ~~~ - ~~~" 식으로 줄만
// 바뀐 채 다닥다닥 붙어 보임(2026-08-22, "단락 구분이 없어서 가독성이 떨어진다"
// 피드백). ERP가 원래 갖고 있던 "가./나." 서식 라벨은 못 가져오지만(report_server.jsp
// 쪽 데이터라 접은 상태), 최소한 텍스트 자체에 이미 있는 "1)/2)/3)..." 같은 번호
// 마커를 기준으로 문단을 나누고, "-"로 시작하는 하위 항목은 들여쓰기해서 눈으로
// 구분되게 함 — 새 데이터 없이 지금 있는 텍스트만으로 가독성을 개선.
// "1)"/"2)" 같은 번호 마커만 새 문단 시작으로 취급 — "※"/"-"는 새 문단을
// 끊지 말고 앞 항목에 딸린 하위 설명으로 계속 묶여야 함(처음엔 ※도 문단
// 구분자로 넣었다가, "3) 신청 장학 종류" 블록이 중간의 ※ 때문에 여러 조각으로
// 쪼개지는 걸 테스트에서 확인하고 수정함).
// 2026-08-22 추가: "다./라./마." 같은 한글 자모 제목 바로 아래 "-"로 시작하는
// 설명줄은 들여쓰기 없이 제목과 같은 레벨로, 그 아래 나오는 번호 목록만 진짜
// 들여쓰기 — kisApi.js의 formatParagraphs(raw_html용)와 같은 상태 기반 규칙을
// raw_text 쪽에도 동일하게 적용(우진 피드백: "가나다 부분 하단에 -로 되어있는건
// 동일 라인으로, 그 밑에 번호 나와있는건 들여쓰기로").
const LETTER_HEADING = /^[가나다라마바사아자차카타파하]\.\s/;
const BLOCK_START = /^\d+[)\.]\s/;
// 한글 문서 특성상 하이픈이 반각(-)뿐 아니라 전각(－)이나 en/em dash(–—),
// 가운뎃점(·), 불릿(•)으로 쓰이는 경우가 있어 폭넓게 잡음.
const SUB_ITEM = /^[-－–—•·※*]\s/;

function FormattedBody({ text }) {
  if (!text) return null;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const blocks = [];
  let current = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (BLOCK_START.test(trimmed) && current.length > 0) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  // sawHeading: "가./나./다." 제목을 한 번이라도 봤으면 계속 true — 그 뒤
  // 번호 목록은 전부 그 제목의 하위항목이라 들여쓰기. 헤딩이 아예 없는
  // 문서(예: "1)/2)/3)"만 있는 경우)는 번호 목록이 최상위라 들여쓰기 안 함
  // (kisApi.js formatParagraphs와 동일한 규칙 — raw_html·raw_text 양쪽 일관성 유지).
  let sawHeading = false;
  let afterHeadingNoNumberYet = false;
  return blocks.map((block, bi) => (
    <div key={bi} className={bi > 0 ? "mt-3" : ""}>
      {block.map((line, li) => {
        const trimmed = line.trim();
        let className = "mt-0.5";
        if (LETTER_HEADING.test(trimmed)) {
          className = "mt-3 font-medium";
          sawHeading = true;
          afterHeadingNoNumberYet = true;
        } else if (BLOCK_START.test(trimmed)) {
          className = sawHeading ? "mt-0.5 pl-4" : "mt-0.5";
          afterHeadingNoNumberYet = false;
        } else if (SUB_ITEM.test(trimmed)) {
          className = afterHeadingNoNumberYet
            ? "mt-0.5 text-brand-muted"
            : sawHeading
            ? "pl-8 mt-0.5 text-brand-muted"
            : "pl-4 mt-0.5 text-brand-muted";
        } else {
          afterHeadingNoNumberYet = false;
        }
        return (
          <p key={li} className={className}>
            <Linkify text={line} />
          </p>
        );
      })}
    </div>
  ));
}

export default function CoopDetailModal({ docId }) {
  const closeDetail = useStore((s) => s.closeDetail);
  const completeDoc = useStore((s) => s.completeDoc);
  const registerCalendar = useStore((s) => s.registerCalendar);
  const downloadAttachment = useStore((s) => s.downloadAttachment);
  // 첨부파일 목록은 openDetail()이 attachNo 있는 문서에 한해 자동으로 라이브
  // 조회해서 여기 채워준다 (store.attachmentsByDocId 참고, 2026-08-21 추가).
  const attachmentState = useStore((s) => s.attachmentsByDocId[docId]);
  // ⚠️ 예전엔 getCoopDoc(docId)로 IndexedDB를 직접 한 번만 읽어서 로컬 state에
  // 박아뒀었음 — 그래서 openDetail()의 라이브 재조회가 IndexedDB를 갱신해도
  // 이미 열린 모달엔 반영이 안 됐음(docId가 안 바뀌니 effect가 재실행 안 됨).
  // store.coopDocs를 직접 구독하도록 바꿔서 store가 갱신되면 자동으로 리렌더되게 함.
  const doc = useStore((s) => s.coopDocs.find((d) => d.id === docId));

  if (!doc) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={closeDetail}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 스크롤해도 상단에 고정 (스크롤 컨테이너가 이 div의 부모이므로
            sticky top-0 + 배경색으로 아래 내용 위에 떠 있게 함) */}
        <div className="sticky top-0 z-10 flex items-start justify-between p-4 border-b border-brand-border bg-white rounded-t-lg">
          <div>
            <h3 className="font-semibold text-brand-navy">{doc.title || "(제목 없음)"}</h3>
            <p className="text-sm text-brand-muted mt-1">
              {doc.sender_dept}
              {doc.drafter && ` · ${doc.drafter}`}
              {doc.date && ` · ${doc.date}`}
            </p>
          </div>
          {/* 2026-08-22: 첨부파일 몇 개인지 X 버튼 밑에 바로 보이도록 추가 —
              스크롤해서 아래 첨부파일 섹션까지 안 봐도 있는지 바로 알 수 있게.
              attachmentState는 openDetail()이 attachNo 있는 문서에 한해 이미
              라이브 조회해서 채워둔 값을 그대로 재사용(중복 조회 없음). */}
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={closeDetail}
              className="text-brand-muted hover:text-brand-muted text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
            {doc.attachNo && (
              <span className="text-xs text-brand-muted whitespace-nowrap">
                {!attachmentState || attachmentState.loading
                  ? "첨부파일 확인 중…"
                  : attachmentState.error
                  ? "첨부파일 확인 실패"
                  : `첨부파일 ${attachmentState.files.length}개`}
              </span>
            )}
          </div>
        </div>

        {/* AI요약 바 (파란 배경) — 2026-09-05(2): action_type 배지 +
            요약(이제 1~2문장으로 짧음) + 기한/조치사항 메타 줄을 추가해서
            카드 목록과 동일한 정보 구조를 상세 팝업에서도 그대로 보여준다. */}
        {doc.ai_summary && (
          <div className="bg-brand-alt border-b border-blue-100 p-4 text-sm text-blue-900">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-wide text-brand-blue">✨ AI Summary</span>
              {doc.action_type && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-blue text-white">
                  {doc.action_type} 필요
                </span>
              )}
            </div>
            {/* 2026-09-05(6): 카드(CoopCard.jsx)와 동일하게 "요약이 밑으로,
                기한/조치가 위로" 순서로 맞춤 — 팝업을 열자마자 언제까지 뭘
                해야 하는지부터 보이게 함. 구분선은 메타 블록 밑으로 이동. */}
            {(doc.deadline || doc.action_description) && (
              <div className="pb-2 mb-2 border-b border-blue-100 flex flex-col gap-0.5 text-[13px]">
                {doc.deadline && (
                  <p>
                    <span className="font-semibold">기한</span> {doc.deadline}
                  </p>
                )}
                {doc.action_description && (
                  <p>
                    <span className="font-semibold">조치</span> {doc.action_description}
                  </p>
                )}
              </div>
            )}
            <p className="whitespace-pre-line">{doc.ai_summary}</p>
          </div>
        )}

        {/* ERP 원문 재현 영역 — 공문 서식 느낌을 살리기 위해 테두리+세리프체로 감쌈.
            raw_html이 있으면(표/목록 구조가 살아있는 정제 HTML, kisApi.js
            extractDetailHtml 결과) 실제 <table>로 렌더링하고, 없으면 기존처럼
            raw_text를 줄바꿈만 살려서 보여준다. — 2026-08-19 "표는 안만들어지네" 대응

            ⚠️ 2026-08-20 실측 확인: findIntAprvDtlList.do 응답엔 ctnt1~ctnt8 중
            값이 있는 필드(보통 ctnt3/ctnt4)만 들어있고, 공문 맨 앞의 "수신/경유/
            제목 + 1~5 안내문단" 같은 공식 서식 인사말은 이 API 응답 자체에 없다
            (ctnt1/ctnt2/basiCtnt/intAprvCtnt 전부 빈 값으로 실측 확인됨). 즉
            아래에 보이는 내용은 "본문 세부 조정내용"이지 공문 전체가 아님 — 착각
            없도록 짧게 안내 문구를 붙임. */}
        <div className="px-4 pt-4">
          {(doc.raw_html || doc.raw_text) && (
            <p className="text-xs text-brand-muted mb-2">
              ※ 아래는 본문 중 세부 내용만 표시됩니다. 수신·경유 등 공문 서식 전체는
              ERP 원본에서 확인해주세요.
            </p>
          )}
        </div>
        {/* 2026-08-22: font-serif → 시스템 sans-serif로 변경. report_server.jsp
            응답에서 실측한 ERP 실제 서식 폰트가 돋움/맑은고딕 계열(sans-serif)이라
            명조체(font-serif)는 오히려 ERP 원본과 다르게 보였음("깔끔하게 안
            나온다" 피드백 원인 중 하나). [&_*] 로 하위 요소 전체에 폰트를 강제
            상속시켜서 raw_html 안에 남아있을 수 있는 개별 요소의 기본 스타일과
            섞여 들쭉날쭉해 보이는 것도 같이 정리. */}
        <div className="px-4 pb-4">
          {doc.raw_html ? (
            <div
              className="border border-brand-border rounded-md bg-white p-4 text-[13px] text-brand-navy leading-[1.7] font-sans
                [&_*]:font-sans [&_*]:text-[13px] [&_*]:leading-[1.7] [&_*]:text-brand-navy
                [&_table]:border-collapse [&_table]:w-full [&_table]:my-2
                [&_td]:border [&_td]:border-brand-border [&_td]:p-1.5 [&_td]:align-top [&_td]:break-keep
                [&_th]:border [&_th]:border-brand-border [&_th]:p-1.5 [&_th]:bg-brand-alt [&_th]:align-middle [&_th]:font-medium [&_th]:text-center [&_th]:break-keep
                [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                [&_p]:my-1.5 [&_td>p:first-child]:mt-0 [&_th>p:first-child]:mt-0 [&_hr]:my-3 [&_hr]:border-brand-border"
              dangerouslySetInnerHTML={{ __html: doc.raw_html }}
            />
          ) : (
            <div className="border border-brand-border rounded-md bg-white p-4 text-[13px] text-brand-navy leading-[1.7] font-sans">
              {doc.raw_text ? (
                <FormattedBody text={doc.raw_text} />
              ) : doc.body_unavailable ? (
                "이 문서는 공문 서식(리포트)으로 작성돼 있어 원문 미리보기를 지원하지 않습니다. ERP에서 직접 확인해주세요."
              ) : (
                "원문 정보가 없습니다."
              )}
            </div>
          )}
        </div>

        {/* 첨부파일 — attachNo가 있는 문서만 표시 (2026-08-21 추가). 목록은
            openDetail()이 이미 라이브로 조회해서 store에 채워둠, 여기선 그 결과만
            읽어서 렌더링 + 다운로드 버튼 클릭 처리만 함. */}
        {doc.attachNo && (
          <div className="px-4 pb-4">
            <p className="text-xs text-brand-muted mb-1.5">첨부파일</p>
            {!attachmentState || attachmentState.loading ? (
              <p className="text-sm text-brand-muted">첨부파일 확인 중…</p>
            ) : attachmentState.error ? (
              <p className="text-sm text-red-500">첨부파일 목록을 불러오지 못했어요.</p>
            ) : attachmentState.files.length === 0 ? (
              <p className="text-sm text-brand-muted">첨부파일이 없습니다.</p>
            ) : (
              <ul className="space-y-1">
                {attachmentState.files.map((file, i) => {
                  const seq = file.seq || i + 1;
                  const attachNo = file.attachNo || doc.attachNo;
                  const name = file.fileNm || file.fileSmryNm || `첨부파일 ${i + 1}`;
                  return (
                    <li
                      key={`${attachNo}-${seq}`}
                      className="flex items-center justify-between gap-2 text-sm border border-brand-border rounded-md px-3 py-1.5"
                    >
                      <span className="truncate text-brand-navy">{name}</span>
                      <button
                        onClick={() => downloadAttachment(attachNo, seq, name)}
                        className="shrink-0 text-brand-blue hover:text-brand-blueDark hover:underline"
                      >
                        다운로드
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ERP 원본 링크 — Nexacro SPA라 특정 문서로 바로 딥링크는 안 되고
            (실측 확인), 협조문수신함 화면까지만 바로 이동시켜줌. 부서 필터도
            URL 쿼리스트링으로는 못 넘김(menuId/pgmId 외엔 SPA가 안 읽음, 실측
            확인 — SPA URL이 화면 이동해도 안 바뀌는 것과 같은 이유). 2026-08-22:
            "수신부서로 선택되어 이동" 요청이 있었는데 이 제약 때문에 자동 선택은
            안 되고, 대신 어느 부서를 골라야 하는지 링크 옆에 바로 보여줘서 수동
            선택을 한 번에 하게끔 함. */}
        <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
          <a
            href={getCoopDocListUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-blue hover:text-brand-blueDark hover:underline"
          >
            ERP에서 원본 보러가기 ↗
          </a>
          {doc.recv_dept_name && (
            <span className="text-xs text-brand-muted">
              수신부서 : {doc.recv_dept_name}
            </span>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="flex items-center justify-between p-4 border-t border-brand-border">
          <button
            onClick={() => completeDoc(doc.id)}
            disabled={doc.is_completed}
            className="text-sm underline text-brand-muted hover:text-brand-navy disabled:text-slate-300 disabled:no-underline disabled:cursor-default"
          >
            {doc.is_completed ? "처리 완료됨" : "완료 처리"}
          </button>

          <button
            onClick={() => registerCalendar(doc.id)}
            disabled={doc.calendar_registered}
            className="text-sm px-3 py-1.5 rounded-md bg-brand-blue text-white hover:bg-brand-blueDark disabled:bg-brand-border disabled:text-brand-muted disabled:cursor-default"
          >
            {doc.calendar_registered ? "캘린더 등록됨" : "캘린더 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
