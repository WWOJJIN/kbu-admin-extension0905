// src/components/ChatPage.jsx
// 챗봇 탭. 사용자가 직접 질문할 때만 동작 (별도 알림 없음 — 알림 규칙).
//
// 7단계(kbu-assistant answerChat 이식): 프록시 서버가 아직 배포되지 않아
// 진짜 Claude API 응답은 아직 안 되지만("아직 준비 중" 스텁으로 방치하는
// 대신), IndexedDB에 쌓인 협조문(title/sender_dept/ai_summary/raw_text)을
// 키워드로 검색해서 관련 문서를 찾아주는 규칙 기반 챗봇으로 임시 대체한다.
// 나중에 프록시가 배포되면 이 파일의 answerChat()만 실제 Claude API 호출로
// 교체하면 되고, 문서 검색/참조 카드 UI는 그대로 재사용 가능하도록 구성해뒀다.

import { useEffect, useRef, useState } from "react";
import useStore from "../store/useStore.js";
import { getAllCoopDocs } from "../lib/db.js";

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

function ChatMessage({ msg, onOpenDoc }) {
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
        "(지금은 키워드 검색 기반 임시 답변이에요 — 프록시 서버가 배포되면 Claude API로 자연스럽게 답하도록 바뀔 예정입니다.)",
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

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    // kbu 원본과 동일하게 살짝 텀을 두고 답한다 (즉답보다 자연스러움).
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

  return (
    <div className="p-4 max-w-2xl mx-auto flex flex-col h-[calc(100vh-60px)]">
      <h2 className="text-lg font-semibold text-brand-navy mb-4">챗봇</h2>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.map((m, i) => (
          <ChatMessage key={i} msg={m} onOpenDoc={handleOpenDoc} />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="질문을 입력하세요 (예: 실습재료비)"
          className="flex-1 border border-brand-border rounded-md px-3 py-2 text-sm"
        />
        <button onClick={send} className="px-4 py-2 bg-brand-blue text-white rounded-md text-sm hover:bg-brand-blueDark">
          전송
        </button>
      </div>
    </div>
  );
}
