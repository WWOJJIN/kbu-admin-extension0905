// src/components/ChatPage.jsx
// 챗봇 탭. 사용자가 직접 질문할 때만 동작 (별도 알림 없음 — 알림 규칙).
//
// 7단계(kbu-assistant answerChat 이식): 프록시 서버가 아직 배포되지 않아
// 진짜 Claude API 응답은 아직 안 되지만("아직 준비 중" 스텁으로 방치하는
// 대신), IndexedDB에 쌓인 협조문(title/sender_dept/ai_summary/raw_text)을
// 키워드로 검색해서 관련 문서를 찾아주는 규칙 기반 챗봇으로 임시 대체한다.
// 나중에 프록시가 배포되면 이 파일의 answerChat()만 실제 Claude API 호출로
// 교체하면 되고, 문서 검색/참조 카드 UI는 그대로 재사용 가능하도록 구성해뒀다.
//
// 2026-09-08 신규: 프록시가 이미 배포됐으니(parseCoopDoc이 실사용 중), 같은
// 프록시로 "협조문/내부기안 초안 작성" 기능을 추가한다. "OOO 관련해서
// 내부기안 작성하려고해 초안 작성해줘"처럼 물으면 keyword 검색 대신 AI가
// 제목/사업개요/본문 초안을 만들어 카드로 보여주고, "작성하러 가기"를 누르면
// background.js → content.js를 거쳐 실제 ERP 작성화면으로 이동해서 그 초안을
// 자동으로 채워준다. 저장(임시저장/상신하기)은 여기서도 자동으로 하지 않음 —
// content.js 상단 주석의 원칙을 그대로 따른다.
//
// 2026-09-08(3) 신규: 친구가 만든 챗봇 서버(kbu.pjhpjh.kr, 연동 계약은
// 팀원이 준 챗봇API_연동정보.md 참고) 연동. "초안 작성" 요청이 아닌 일반
// 질문은 이제 그 서버를 먼저 시도하고, 실패(네트워크 오류/서버 오류/응답
// 형식 이상)하면 기존 로컬 키워드 검색(searchDocs)으로 자동 폴백한다 —
// md 문서에 명시된 계약 그대로. "초안 작성 → 작성하러 가기(ERP 이동)" 쪽은
// 이 변경과 무관하게 그대로 둔다(우진 요청 — "ERP로 이동되는 기능은 고정").
// manifest.json host_permissions에 kbu.pjhpjh.kr을 추가해야 이 fetch가
// CORS에 안 걸린다.

import { useEffect, useRef, useState } from "react";
import useStore from "../store/useStore.js";
import { getAllCoopDocs } from "../lib/db.js";
import { draftDocument } from "../lib/claudeApi.js";

/**
 * kbu-assistant js/app.js의 answerChat을 그대로 이식 — 제목/발신부서/AI요약/
 * 본문에 질의어가 포함된 문서를 찾아 반환한다.
 * @param {string} query
 * @param {Array<Object>} docs
 * @returns {Array<Object>}
 */
function searchDocs(query, docs) {
  const q = query.toLowerCase();
  return docs.filter((d) => {
    const haystack = [d.title, d.sender_dept, d.ai_summary, d.raw_text]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

// "초안"/"작성해줘" 같은 표현 + 문서 종류(내부기안/협조문) 중 하나가 명확히
// 있을 때만 초안 작성 요청으로 인식한다. 문서 종류가 없거나 둘 다 섞여있으면
// (예: "협조문이랑 내부기안 차이가 뭐야") 애매하니 안전하게 기존 키워드
// 검색으로 흘려보낸다 — 잘못 짐작해서 엉뚱한 화면으로 보내는 것보다 낫다.
function parseDraftIntent(text) {
  const looksLikeDraftRequest = /초안|작성\s*해\s*줘|써\s*줘|써줄래/.test(text);
  if (!looksLikeDraftRequest) return null;
  const has내부기안 = text.includes("내부기안");
  const has협조문 = text.includes("협조문");
  if (has내부기안 && !has협조문) return "내부기안";
  if (has협조문 && !has내부기안) return "협조문";
  return null;
}

const EXTERNAL_CHATBOT_URL = "https://kbu.pjhpjh.kr/chatbot/chat";
const EXTERNAL_CHATBOT_TIMEOUT_MS = 7000;

/**
 * 친구의 챗봇 서버를 호출한다. 응답에서 reply/answer/message/text/response
 * 필드를 순서대로 확인해 답변 텍스트를 뽑고, refs 또는 docs 배열이 있으면
 * 그대로 참고문서 카드로 넘긴다(ChatMessage의 msg.refs가 기대하는 필드명인
 * id/title/sender_dept/date와 md 문서의 예시가 이미 같아서 변환 없이 바로 씀).
 * 응답 텍스트를 못 찾거나 요청 자체가 실패/타임아웃되면 에러를 던진다 —
 * 호출부(handleGeneralQuestion)가 이걸 잡아서 로컬 검색으로 폴백한다.
 * @param {string} text
 * @returns {Promise<{ text: string, refs: Array<Object> }>}
 */
async function callExternalChatbot(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_CHATBOT_TIMEOUT_MS);
  try {
    const res = await fetch(EXTERNAL_CHATBOT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`챗봇 서버 응답 오류: ${res.status}`);
    const data = await res.json();
    const replyText = data?.reply ?? data?.answer ?? data?.message ?? data?.text ?? data?.response;
    if (typeof replyText !== "string" || !replyText.trim()) {
      throw new Error("챗봇 서버 응답에서 답변 텍스트를 찾지 못함");
    }
    const refs = Array.isArray(data?.refs) ? data.refs : Array.isArray(data?.docs) ? data.docs : [];
    return { text: replyText, refs };
  } finally {
    clearTimeout(timer);
  }
}

function ChatMessage({ msg, onOpenDoc, onGoWrite }) {
  const isUser = msg.role === "user";
  return (
    <div className={`max-w-[85%] ${isUser ? "ml-auto" : ""}`}>
      <div
        className={`rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
          isUser ? "bg-brand-blue text-white ml-auto" : "bg-brand-alt text-brand-navy"
        }`}
      >
        {msg.text}
      </div>
      {msg.refs && msg.refs.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {msg.refs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onOpenDoc(doc.id)}
              className="text-left bg-white border border-brand-border rounded-lg px-3 py-2 hover:bg-brand-alt"
            >
              <p className="text-sm font-medium text-brand-navy truncate">{doc.title || "(제목 없음)"}</p>
              <p className="text-xs text-brand-muted">
                {doc.sender_dept} {doc.date ? `· ${doc.date}` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
      {msg.draft && <DraftCard draft={msg.draft} onGoWrite={onGoWrite} />}
    </div>
  );
}

// AI가 만든 초안(제목/사업개요/본문)을 보여주고, "작성하러 가기"로 실제 ERP
// 작성화면 자동 채움을 트리거하는 카드. status는 idle → moving → done/error로
// 바뀐다(ChatPage의 handleGoWrite가 msg.draft.status를 갱신).
function DraftCard({ draft, onGoWrite }) {
  const { docType, title, overview, purposeHtml, targetHtml, procedureHtml, status } = draft;
  // 내부기안은 목적/대상/진행절차 세 칸, 협조문은 아직 협조내용 한 칸만 채우므로
  // (content.js DOC_TYPE_CONFIG 참고) 라벨을 문서 종류에 맞게 다르게 보여준다.
  const sections =
    docType === "협조문"
      ? [{ label: "협조내용", html: purposeHtml }]
      : [
          { label: "목적", html: purposeHtml },
          { label: "대상", html: targetHtml },
          { label: "진행절차", html: procedureHtml },
        ];

  return (
    <div className="mt-1.5 bg-white border border-brand-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-brand-border flex items-center justify-between">
        <span className="text-[11px] font-bold text-brand-blueDark bg-brand-alt px-2 py-0.5 rounded-full">
          {docType} 초안
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-2.5">
        <p className="text-sm font-semibold text-brand-navy">{title || "(제목 없음)"}</p>
        {overview && <p className="text-xs text-brand-muted whitespace-pre-line">{overview}</p>}
        {sections.map(
          (s) =>
            s.html && (
              <div key={s.label}>
                <p className="text-[10.5px] font-bold text-brand-muted mb-0.5">{s.label}</p>
                <div
                  className="text-xs text-brand-navy leading-relaxed [&_p]:mb-1 last:[&_p]:mb-0"
                  dangerouslySetInnerHTML={{ __html: s.html }}
                />
              </div>
            )
        )}
        {docType === "내부기안" && (
          <p className="text-[10.5px] text-brand-muted">예산 칸은 자동으로 못 채워요 — ERP에서 직접 입력해주세요.</p>
        )}
      </div>
      <div className="px-3 py-2 border-t border-brand-border bg-brand-alt/40 flex items-center justify-between gap-2">
        <p className="text-[11px] text-brand-muted">
          {status === "moving" && "ERP 작성화면으로 이동해서 채우는 중..."}
          {status === "done" && "ERP 작성화면에 채워뒀어요. 내용을 확인하고 직접 저장해주세요."}
          {status === "error" && `자동 채움 실패: ${draft.error || "알 수 없는 오류"}`}
          {(!status || status === "idle") && "실제 저장은 자동으로 하지 않아요 — 마지막 확인은 직접 해주세요."}
        </p>
        <button
          onClick={onGoWrite}
          disabled={status === "moving"}
          className="flex-shrink-0 px-3 py-1.5 bg-brand-blue text-white rounded-md text-xs font-semibold hover:bg-brand-blueDark disabled:opacity-50"
        >
          {status === "moving" ? "이동 중..." : "작성하러 가기"}
        </button>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const setActiveTab = useStore((s) => s.setActiveTab);
  const openDetail = useStore((s) => s.openDetail);

  const [docs, setDocs] = useState([]);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "안녕하세요! 협조문·결재현황에 저장된 내용을 바탕으로 질문에 답해드려요.\n" +
        "예: '간호학부', '실습재료비', '차량 지원' 처럼 키워드로 물어보세요.\n" +
        "'OOO 관련해서 내부기안 작성하려고해 초안 작성해줘'처럼 물어보면 초안을 만들어드리고, " +
        "\"작성하러 가기\"를 누르면 ERP 작성화면에 자동으로 채워드려요(저장은 직접 해주셔야 해요).\n" +
        "(키워드 질문은 지금 검색 기반 임시 답변이에요 — 나중에 자연스러운 답변으로 바뀔 예정입니다.)",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    getAllCoopDocs()
      .then(setDocs)
      .catch((err) => console.warn("[ChatPage] 협조문 목록 로드 실패:", err));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleOpenDoc = (id) => {
    setActiveTab("coop");
    openDetail(id);
  };

  // msgIndex 위치의 메시지가 들고 있는 draft에 상태(status)/에러를 병합한다.
  // draft 카드가 메시지 배열 안에 중첩돼있어 setMessages로 그 메시지만 갱신.
  const updateDraftAt = (msgIndex, patch) => {
    setMessages((m) =>
      m.map((msg, i) => (i === msgIndex ? { ...msg, draft: { ...msg.draft, ...patch } } : msg))
    );
  };

  const handleGoWrite = async (msgIndex) => {
    const draft = messages[msgIndex]?.draft;
    if (!draft) return;
    updateDraftAt(msgIndex, { status: "moving", error: null });
    try {
      const res = await chrome.runtime.sendMessage({
        type: "KBU_ASSISTANT_GOTO_ERP_DRAFT",
        payload: {
          docType: draft.docType,
          title: draft.title,
          overview: draft.overview,
          purposeHtml: draft.purposeHtml,
          targetHtml: draft.targetHtml,
          procedureHtml: draft.procedureHtml,
        },
      });
      if (!res?.ok) throw new Error(res?.error || "알 수 없는 오류");
      updateDraftAt(msgIndex, { status: "done" });
    } catch (err) {
      updateDraftAt(msgIndex, { status: "error", error: err?.message || String(err) });
    }
  };

  const handleDraftRequest = async (text, docType) => {
    setMessages((m) => [...m, { role: "assistant", text: `${docType} 초안을 작성하고 있어요...` }]);
    try {
      const drafted = await draftDocument(text, docType);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `${docType} 초안을 만들었어요. 내용을 확인하고 "작성하러 가기"를 눌러주세요.`,
          draft: { ...drafted, docType, status: "idle" },
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `초안 작성에 실패했어요: ${err?.message || err}` },
      ]);
    }
  };

  // 로컬 키워드 검색으로 답하는 기존 방식 — 친구 챗봇 API가 실패했을 때의
  // 폴백으로 쓴다(예전엔 이게 기본 경로였음). kbu 원본과 동일하게 살짝 텀을
  // 두고 답한다(즉답보다 자연스러움).
  const answerWithLocalSearch = (text) => {
    setTimeout(() => {
      const matches = searchDocs(text, docs);
      if (matches.length === 0) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: "관련된 문서를 찾지 못했어요. 부서명이나 협조문 키워드로 다시 물어봐 주세요.",
          },
        ]);
        return;
      }
      const top = matches.slice(0, 3);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `관련 문서 ${matches.length}건을 찾았어요. 가장 관련 있는 문서부터 보여드릴게요.`,
          refs: top,
        },
      ]);
    }, 300);
  };

  // 초안 작성 요청이 아닌 일반 질문 처리: 친구의 챗봇 API를 먼저 시도하고,
  // 실패하면(네트워크 오류/서버 오류/응답 형식 이상/타임아웃) 조용히 로컬
  // 검색으로 넘어간다 — 사용자에게는 에러를 보여주지 않고 그냥 검색 결과가
  // 나온 것처럼 이어진다(챗봇API_연동정보.md에 명시된 폴백 계약).
  const handleGeneralQuestion = async (text) => {
    try {
      const { text: replyText, refs } = await callExternalChatbot(text);
      setMessages((m) => [...m, { role: "assistant", text: replyText, refs }]);
    } catch (err) {
      console.warn("[ChatPage] 챗봇 API 호출 실패, 로컬 검색으로 대체:", err);
      answerWithLocalSearch(text);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    const draftDocType = parseDraftIntent(text);
    if (draftDocType) {
      handleDraftRequest(text, draftDocType);
      return;
    }

    handleGeneralQuestion(text);
  };

  return (
    <div className="p-4 max-w-2xl mx-auto flex flex-col h-[calc(100vh-60px)]">
      <h2 className="text-lg font-semibold text-brand-navy mb-4">챗봇</h2>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.map((m, i) => (
          <ChatMessage key={i} msg={m} onOpenDoc={handleOpenDoc} onGoWrite={() => handleGoWrite(i)} />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="질문을 입력하세요 (예: 실습재료비, 또는 'OOO 내부기안 초안 작성해줘')"
          className="flex-1 border border-brand-border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={send} className="px-4 py-2 bg-brand-blue text-white rounded-md text-sm hover:bg-brand-blueDark">
          전송
        </button>
      </div>
    </div>
  );
}
