// src/lib/kisApi.js
// KBU 통합정보시스템(kis.kbu.ac.kr) ERP 내부 API 요청/응답 처리 유틸.
//
// ⚠️ 중요: background.js는 Manifest V3 Service Worker로 동작하는데, 서비스워커에는
// DOM이 없어서 DOMParser/document를 쓸 수 없다. 그래서 아래 XML 빌드/파싱은
// 전부 정규식 기반으로 직접 구현했다 (offscreen document 안 씀 — 지금 단계에선
// 과한 복잡도라 판단).
//
// ✅ 2026-08-08 실측 완료 (협조문수신함/findIntAprvDeptDocList.do): 아래 두 가지가
// 최초 추정과 달랐다.
//   1. URL에 쿼리스트링 menuId/pgmId가 필수로 붙는다 (예: ?menuId=M106642&pgmId=P007220).
//      화면(엔드포인트)마다 고유값이라 나머지 endpoint는 아직 값을 모름 — 실제 호출
//      전에 Network 탭에서 각각 캡처해서 ENDPOINTS에 채워넣어야 함 (아래 null 표시).
//   2. Dataset의 ColumnInfo는 그 화면이 지원하는 "전체" 필터 컬럼 스키마를 항상 선언
//      하고, Rows>Row>Col은 실제 값이 있는 필드만 넣는다 (예: 12개 컬럼 선언, 값은
//      stGbn/docDeptCd 2개만). buildXmlRequest가 columnSchema 인자로 이를 지원함.
//   3. <Parameters>엔 dsCollection이 아니라 Nexacro 런타임이 쿠키에서 긁어온 것으로
//      보이는 _ga* 트래킹 값들 + requestTimeStr(타임스탬프)가 들어있었음. _ga* 값은
//      GA 트래킹 아티팩트로 보여 재현하지 않았고(세션 인증은 credentials:"include"로
//      실제 Cookie 헤더가 이미 전송됨), requestTimeStr만 자동 생성해서 넣음. 서버가
//      거부하면 _ga* 값도 필요하다는 뜻이니 그때 추가.
//   4. 응답도 실측 완료: 응답 Dataset id는 요청과 다르게 "DS_BSNS052"로 내려옴
//      (fetchCoopDocList에서 responseDatasetId로 명시). 값에 공백이 있으면 일반
//      스페이스가 아니라 "&#32;" 숫자 엔티티로 인코딩되어 있었고, decodeXmlEntities가
//      이미 처리함(테스트로 검증 완료). 값이 없는 필드는 <Col>이 아예 생략되므로
//      record에 해당 key가 없을 수 있음 — 소비하는 쪽에서 옵셔널 체이닝 필요.
// 나머지 5개 endpoint(expenseTravelList/internalDraftList/detail/aprvStatus/attachList)는
// 아직 실측 전이라 위 구조를 기준으로 한 추정치. 호출 전 Network 탭으로 재검증할 것.
//
// ✅ 2026-08-19 실측 완료 (협조문 상세/findIntAprvDtlList.do, 첨부파일목록/
// findSavedAttachDocList.do):
//   1. detail의 menuId/pgmId는 원래 "미검증 추정"이었던 M106642/P007220이 실제로
//      맞았음(협조문수신함과 동일 화면). attachList도 동일하게 M106642/P007220으로
//      확인됨 — 아래 ENDPOINTS 갱신함.
//   2. 응답 Dataset도 목록과 동일하게 id="DS_BSNS052"로 내려오고, 컬럼이 90개 이상
//      선언됨. 본문 실제 내용은 ctnt1~ctnt8 중 값이 있는 필드에 나뉘어 들어있다
//      (실측 문서는 ctnt3="가.나.다. 형태의 본문+표", ctnt4="제출방법/기한 등
//      안내문+별도 표" — 즉 한 문서가 여러 ctnt 필드에 걸쳐 나뉠 수 있으므로 첫
//      번째로 값 있는 필드 하나만 쓰면 내용이 잘린다).
//   3. 서버가 ctnt1~ctnt8(HTML)뿐 아니라 ctnt1Tmp~ctnt8Tmp(같은 내용을 서버가 이미
//      태그 제거해둔 평문 버전)도 같이 내려줌. Tmp가 있으면 그걸 우선 쓰고(우리가
//      decodeRichText로 태그를 다시 벗길 필요 없음), 없으면 HTML 버전을 태그
//      제거해서 씀. extractDetailText()가 이 로직을 구현함.
//   4. callReport.jsp/report_server.jsp(Nexacro clipreport5 리포트 뷰어)는 원문
//      텍스트 추출과 무관 — 클라이언트에서 렌더링하는 인쇄용 뷰어 부트스트랩
//      HTML일 뿐, 실제 본문 데이터는 findIntAprvDtlList.do 쪽에만 있음. 원문
//      추출 로직에서 callReport.jsp는 쓰지 않는다.
//
// ⚠️ 2026-08-20 실측 정정 (위 4번 결론의 예외 발견): ctnt1~8 필드가 "본문 전체"를
//   담고 있다는 가정은 완전한 문서(공문 서식 없이 ctnt만으로 이루어진 문서)에는
//   맞지만, 공식 서식(수신/경유/제목 + 번호 매긴 인사말 문단)을 갖춘 협조문은
//   그 서식 앞부분이 ctnt1~8/basiCtnt/intAprvCtnt 어디에도 안 들어있다(실측:
//   aprvNo=00131407, 전체 응답 캡처로 ctnt1/ctnt2를 포함한 모든 undefined 필드가
//   실제로 빈 값임을 확인 — trimmed 테스트 파일이 아니라 완전한 응답으로 재검증
//   완료). 이 경우 ctnt3/ctnt4 등은 "본문 중 세부 조정내용"만 담고, 서식 앞부분은
//   Nexacro 리포트 뷰어가 별도 데이터 소스로 그리는 것으로 추정됨(미확인 —
//   callReport.jsp의 실제 네트워크 요청을 아직 추적 안 함). 그래서 UI에서는
//   raw_html/raw_text가 "본문 전체"가 아니라 "세부 내용만"이라는 걸 명시하고
//   있음(CoopDetailModal.jsx 안내 문구 참고).

// 5단계(kbu-assistant 이식): 부서코드 자동수집/겸직 부서코드 필터링에 사용.
import { getMeta, setMeta } from "./db.js";

const BASE_URL = "https://kis.kbu.ac.kr";

/**
 * extractDetailText/decodeRichText의 "추출 로직 버전". 이 숫자를 바꾸면 이미
 * IndexedDB에 저장된 문서도(본문이 이미 채워져 있어도) 상세 팝업을 열 때 한 번
 * 라이브로 재추출해서 최신 포맷으로 갱신된다 (useStore.js의 needsReExtract 참고).
 *
 * ⚠️ 왜 필요한가: raw_text가 이미 값이 있고 title과도 다르면 "정상 추출된 문서"로
 * 간주해서 다시는 재조회 안 하는 게 기존 로직이었다. 근데 decodeRichText의 표
 * 처리 로직을 나중에 개선해도, 예전에 이미 저장된 문서는 "이미 값이 있으니
 * 정상"으로 판단돼 옛날 포맷(표가 뭉개진 텍스트) 그대로 영구히 남는 문제가 있었음
 * (2026-08-19 실사용 중 발견 — 표 구분자 추가했는데 이미 열어본 문서엔 반영 안 됨).
 * 이 버전 번호를 저장해두고 비교하는 방식으로 해결.
 */
// v1: 최초 ctnt1~8 병합, v2: 표/리스트 구분자 추가(잘못된 추측 — 회귀 발생),
// v3: v2 되돌리고 "닫는 태그=줄바꿈"만 안전하게 추가,
// v4: ctnt{i}Tmp보다 원본 HTML(ctnt{i})을 우선하도록 변경 — 실측 결과 Tmp는
// 블록 경계 없이 전부 이어붙은 문자열이라 표 있는 문서가 통째로 뭉개졌었음,
// v5: raw_html(실제 <table> 렌더링용 정제 HTML) 필드 추가,
// v6: basiCtnt/intAprvCtnt/coopCtnt("사업개요/머리글" 후보 필드) 추가 — 기안자에
// 따라 본문을 "사업개요/머리글"에 쓰는 사람과 "주요내용"에 쓰는 사람이 갈려서
// (2026-08-22, 우진 지적) ctnt1~8만으론 못 잡는 문서가 있을 수 있음
// v7: sanitizeRichHtml이 td/th의 colspan·rowspan을 보존하고, 빈 문단/연속
// <br>을 눌러서 raw_html 표·간격이 ERP 원본처럼 깔끔하게 나오도록 개선
// v8: extractDetailHtml 결과에 linkifyHtml 적용 — 본문 안 URL(구글드라이브
// 링크 등)이 평문으로만 있어도 클릭 가능한 <a>로 감싸줌
// v9: extractDetailHtml에 formatParagraphs 적용 — raw_html의 <p>들이 전부
// 똑같은 간격만 받던 걸, 번호 항목(1)/2)/3)...)마다 여백을 더 주고 "-"/"※"
// 하위 항목은 들여쓰기하도록 개선(raw_text쪽 FormattedBody와 같은 로직을
// HTML 문자열 레벨에서 재구현)
// v10: formatParagraphs에 "가./나./다." 한글 자모 제목 처리 추가 — 제목 바로
// 아래 "-" 설명줄은 들여쓰기 안 하고 제목과 같은 레벨로, 그 아래 번호 목록만
// 들여쓰기(직전 문단이 뭐였는지 추적하는 상태 기반 처리로 변경)
export const RAW_TEXT_EXTRACT_VERSION = 10;

// recv_dept_code/recv_dept_name 스키마 버전.
// v1: (버그) "어느 docDeptCd로 조회했는지"를 _recvDeptCode/_recvDeptName으로
//     태깅 — ERP "부서" 드롭다운이 실제로는 목록을 필터링하지 않는다는 걸
//     몰랐을 때 만든 잘못된 로직. 실측(2026-08-22, 사용자 ERP 스크린샷 3장 +
//     findIntAprvDeptDocList.do 실제 응답 XML)으로 틀렸음이 확인됨.
// v2: 응답 Row 자체의 rcvDeptCd/rcvDeptNm("수신부서" 컬럼, 실측 확인)을 그대로
//     사용하도록 수정. v1으로 이미 저장된 문서는 값이 잘못됐어도 "이미 있으니
//     정상"으로 판단돼 영구히 안 고쳐지는 문제가 있어(raw_text_version과 같은
//     이유), 버전 번호를 같이 저장해서 비교하는 방식으로 강제 재보정한다.
export const RECV_DEPT_SCHEMA_VERSION = 2;

export const ENDPOINTS = {
  coopDocList: {
    path: "/com/UmgjCtr/findIntAprvDeptDocList.do", // 협조문수신함
    menuId: "M106642",
    pgmId: "P007220",
  },
  // 2026-08-23(8) 실측값 반영 — 별도 프로토타입(chrome.storage.local 기반
  // 초기 검증 버전)에서 Network 탭으로 이미 캡처/재현 테스트까지 끝낸 값을
  // 가져옴. 실측 전에도 menuId/pgmId 없이 이미 정상 데이터가 오긴 했지만
  // (ERP가 이 값들을 엄격히 검증하지 않는 듯), 정확한 값을 알고 있으니 그대로
  // 채워서 TODO/미검증 상태를 없앤다.
  expenseTravelList: {
    path: "/com/UmgjCtr/findDraftList.do", // 지출출장결재현황 (내가 기안한 것)
    menuId: "M100034",
    pgmId: "P000024",
  },
  internalDraftList: {
    path: "/com/UmgjCtr/findIntAprvDraftList.do", // 내부기안결재현황
    menuId: "M106624",
    pgmId: "P007210",
  },
  detail: {
    path: "/com/UmgjCtr/findIntAprvDtlList.do", // 협조문 상세
    menuId: "M106642", // 2026-08-19 실측 확인: 협조문수신함과 동일 화면 맞음
    pgmId: "P007220",
  },
  aprvStatus: {
    path: "/com/UmgjCtr/findAprvStatusList.do", // 결재단계 상세
    menuId: null, // TODO
    pgmId: null,
  },
  attachList: {
    // ⚠️ 2026-08-21 정정: findSavedAttachDocList.do + aprvNo는 틀린 엔드포인트였음
    // (실측: 매번 빈 <Rows></Rows>만 응답). 팀원이 findFileDetailList.do +
    // attachNo(첨부그룹 식별자, 목록/상세 응답의 attachNo 필드)로 100% 실측
    // 확인한 걸 그대로 반영. Dataset 형식이 아니라 <Parameters>만 채우는
    // 요청이라 buildParamsOnlyXmlRequest/postParamsOnly를 따로 씀.
    path: "/com/FileCtr/findFileDetailList.do",
    menuId: "M106642",
    pgmId: "P007220",
  },
  fileDownload: {
    // 첨부파일 바이너리 다운로드. Nexacro XML이 아니라 일반 form-urlencoded
    // 요청이고 응답도 XML이 아니라 파일 바이트 그대로 옴 (2026-08-21, 팀원 실측).
    path: "/com/FileCtr/fileDefaultDownload.do",
    menuId: "M106642",
    pgmId: null,
  },
  activityLog: {
    path: "/com/SlogCtr/saveBtnLog.do", // 활동 로그 (세션 연장 안전장치, 선택)
    menuId: null,
    pgmId: null,
  },
  // 지출출장결재하기: 나에게 결재가 올라와서 내가 처리해야 하는 건들.
  //   expenseTravelList(findDraftList.do, 지출출장결재현황)는 "내가 기안한
  //   것"의 진행 상태고, 이건 반대로 "나에게 결재 요청이 온 것" 목록이라
  //   완전히 다른 화면임 — 알림 커버리지에서 빠져있던 4번째 화면 (2026-08-23
  //   추가). menuId/pgmId는 별도 프로토타입(chrome.storage.local 기반 초기
  //   검증 버전)에서 이미 실측 확인된 값을 그대로 가져옴.
  aprvMngList: {
    path: "/com/UmgjCtr/findAprvMngList.do",
    menuId: "M100033",
    pgmId: "P000020",
  },
  // 2026-08-22 실측 완료 — 협조문수신함 화면의 "부서" 드롭다운을 채우는 API.
  // 로그인 계정의 "최근 1년 발령 부서" 전체를 돌려줌(응답 Dataset "DS_DEPT",
  // Col deptCd/deptNm). 이전엔 이 목록을 화면 캡처로 손으로 옮겨써서
  // MY_DEPARTMENTS에 하드코딩했었는데, 이 API로 대체해서 계정마다 자동으로
  // 본인 소속 부서를 가져오게 함(다른 부서 사람에게 배포해도 동작).
  //
  // ⚠️ 2026-08-23(14) 정정 — "부서가 6개여야 하는데 2개만 뜬다" 리포트로
  // Claude in Chrome을 이용해 실제 로그인된 kis.kbu.ac.kr 세션에서 협조문
  // 수신함 화면을 열고 devtools Network 로그를 직접 캡처해서 확인함: 이
  // 화면이 실제로 호출하는 경로는 findPersOford**D**eptList.do (Ofor**d**,
  // o가 하나 더 있음)이었고, 아래 있던 findPersOfr**d**DeptList.do(Ofrd)는
  // 처음부터 오타였다 — 그동안 이 상수를 쓰는 모든 요청이 매번 실패해서
  // (서버가 200 OK로 "페이지를 찾을 수 없습니다" 안내 HTML을 돌려주고,
  // postDataset이 Dataset이 아니라고 판단 → 재시도까지 실패 → 에러) 소속
  // 부서 목록을 한 번도 제대로 받아온 적이 없었음. fetchMyCoopDocList()의
  // catch가 이 실패를 조용히 삼키고 매번 "필터링 없이 전체 반환"으로
  // 빠졌던 것, CoopPage.jsx의 부서 드롭다운이 몇 개 안 뜨던 것 모두 이
  // 오타 하나가 원인. 실측(2026-08-23)으로 이 경로가 정확히 6개 부서
  // (혁신지원사업단/디지털트윈연구원×2(코드 다름, 이름만 같음)/AI디지털트윈
  // 연구원(공백 있음)/빅데이터과/소프트웨어융합과)를 반환하는 것까지 확인 완료.
  persOfrdDeptList: {
    path: "/com/UmgjCtr/findPersOfordDeptList.do",
    menuId: "M106642",
    pgmId: "P007220",
  },
  // 2026-08-22 실측 완료 (Network 탭 캡처) — 로그인 사용자 이름. 응답 Row에
  // Col id="userNm" 필드로 내려옴(예: "김우진"). 앱 로드 시 부트스트랩으로
  // 한 번 호출되는 공통 화면(menuId=M000000/pgmId=P000000 — 특정 업무 화면이
  // 아니라 프레임워크 공통 영역이라 다른 계정도 이 값 그대로 쓸 것으로 보임).
  isLogin: {
    path: "/com/SsoCtr/isLogin.do",
    menuId: "M000000",
    pgmId: "P000000",
  },
  // 2026-08-22 실측 완료 — 로그인 사용자의 소속+직급 정보. 응답 Dataset
  // "DS_USER_GB"에 여러 Row가 올 수 있음(한 계정이 재직/졸업 등 여러 신분을
  // 가질 수 있어서) — currentLoginUser==="1"인 행이 지금 로그인한 프로필.
  // userGbnNm 필드가 이미 "교직원(혁신지원사업단,산단 사-조교)"처럼 소속·직급을
  // ERP 자체 포맷으로 합쳐서 내려주므로, 우리가 "소속1/소속2 직급" 식으로
  // 다시 쪼개 조립하지 않고 이 문자열을 그대로 씀 — 사람마다 신분 표기 포맷이
  // 다를 수 있어서(교직원 vs 학생 행 포맷이 이미 다름, 실측으로 확인) 잘못
  // 쪼개면 다른 부서 사람에게 배포했을 때 이상하게 보일 위험이 있음.
  userGbList: {
    path: "/com/UserCtr/findUserGbList.do",
    menuId: "M000000",
    pgmId: "P000000",
  },
  // 4단계(학적변동대상자목록, kbu-assistant 이식): menuId/pgmId는 kbu 쪽 계정
  // (W님 계정)에서 실측된 값을 그대로 가져옴 — 이 프로젝트(admin) 계정에서는
  // 아직 재검증 안 됐으므로, 권한이 없어 실패하면 background.js가 자동으로
  // 기능 토글을 꺼버리도록 되어있다(runStatusChangeSync 참고).
  statusChangeList: {
    path: "/uni/sreg/SregModiCtr/findSrhregModAccpList.do", // 학적변동대상자목록
    menuId: "M104947",
    pgmId: "P005858",
  },
  statusChangeStages: {
    path: "/uni/sreg/SregModiCtr/findSrhregModAccpStgList.do", // 학적변동 승인단계별 현황
    menuId: "M104947",
    pgmId: "P005858",
  },
  // 2026-09-05 실측 완료 — 로그인 계정이 실제로 권한을 가진 메뉴 전체 목록.
  // isLogin/userGbList와 마찬가지로 menuId=M000000/pgmId=P000000인 공통 화면
  // (특정 업무 메뉴가 아니라 프레임워크 부트스트랩 영역). 응답 Dataset
  // "DS_MENULIST"에 menuId 컬럼이 있고, 이 목록에 없는 menuId는 그 계정이
  // ERP 메뉴로는 절대 들어갈 수 없는 화면이라는 뜻 — 즉 ERP가 하는 메뉴 권한
  // 검사를 그대로 재현할 수 있음. 실측: 권한 없는 계정(W) 응답엔 학적변동승인처리
  // (M104947)가 없고, 권한 있는 계정 응답엔 있음 — 대조 확인 완료.
  // ⚠️ Content-Type/헤더가 postDataset과 달라서(text/plain + Reqfoundataion:
  // nexacro) postParamsOnly로 호출해야 함(findAttachDocList.do와 동일 패턴).
  authMenuList: {
    path: "/com/MenuCtr/findAuthMenuList.do",
    menuId: "M000000",
    pgmId: "P000000",
  },
};

/**
 * 협조문수신함(DS_COND)의 실측된 전체 필터 컬럼 스키마.
 * 실제 값 없이도 ColumnInfo에는 전부 선언되고, Row에는 값 있는 필드만 들어간다.
 */
export const COOP_DOC_LIST_SCHEMA = [
  "bussGbn",
  "bussSmClsfGbn",
  "subject",
  "draftEmpNm",
  "aprvNo",
  "draftDtFrom",
  "draftDtTo",
  "lastAprvDtFrom",
  "lastAprvDtTo",
  "bigStGbn",
  "stGbn",
  "docDeptCd",
];

// ---------------------------------------------------------------------------
// XML 빌드
// ---------------------------------------------------------------------------

/**
 * Nexacro 데이터셋 XML 요청 바디를 만든다.
 * @param {string} datasetId  예: "DS_COND"
 * @param {Object<string,string>} params  { stGbn: "A", docDeptCd: "1234" } 형태 (값 있는 필드만)
 * @param {string[]} [columnSchema]  화면이 지원하는 전체 필터 컬럼 목록. 생략 시 params의
 *   key만으로 ColumnInfo를 만듦(실측 안 된 화면용 fallback). 실측된 화면은 반드시
 *   COOP_DOC_LIST_SCHEMA 같은 전체 스키마 상수를 넘길 것.
 * @returns {string} XML 문자열
 */
export function buildXmlRequest(datasetId, params = {}, columnSchema) {
  const schema = columnSchema && columnSchema.length ? columnSchema : Object.keys(params);

  const columnInfo = schema
    .map((key) => `<Column id="${key}" type="STRING" size="256"/>`)
    .join("");
  const cols = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `<Col id="${key}">${escapeXml(String(value))}</Col>`)
    .join("");

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<Root xmlns="http://www.nexacroplatform.com/platform/dataset">` +
    `<Parameters><Parameter id="requestTimeStr">${Date.now()}</Parameter></Parameters>` +
    `<Dataset id="${datasetId}">` +
    `<ColumnInfo>${columnInfo}</ColumnInfo>` +
    `<Rows><Row>${cols}</Row></Rows>` +
    `</Dataset>` +
    `</Root>`
  );
}

/**
 * 일부 API(findFileDetailList.do 등)는 <Dataset> 없이 <Parameters>만 채워서
 * 보낸다 (2026-08-21, 팀원 실측 확인). buildXmlRequest와 별개로 둠.
 * @param {Object<string,string>} params
 * @returns {string} XML 문자열
 */
export function buildParamsOnlyXmlRequest(params = {}) {
  const paramTags = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `<Parameter id="${key}">${escapeXml(String(value))}</Parameter>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Root xmlns="http://www.nexacroplatform.com/platform/dataset">` +
    `<Parameters>${paramTags}<Parameter id="requestTimeStr">${Date.now()}</Parameter></Parameters>` +
    `</Root>`
  );
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// XML 파싱 (DOM 없이 정규식 기반)
// ---------------------------------------------------------------------------

const XML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * HTML/XML 엔티티(&amp; &#44032; 등)를 실제 문자로 디코딩. DOM 없이 동작.
 * @param {string} str
 * @returns {string}
 */
function decodeXmlEntities(str) {
  if (!str) return "";
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCharCode(code);
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

/**
 * Nexacro 데이터셋 XML 응답을 파싱해서 일반 객체 배열로 변환한다.
 * <Col id="key">value</Col> 형태와, id 속성 없이 <Col>value</Col>만 오는 경우
 * (ColumnInfo 순서로 매핑) 둘 다 대응.
 * @param {string} xmlText
 * @param {string} [datasetId]  특정 Dataset만 뽑고 싶을 때 (예: "DS_BSNS052"). 생략 시 첫 Dataset.
 * @returns {Array<Object<string,string>>}
 */
export function parseXmlResponse(xmlText, datasetId) {
  if (!xmlText) return [];

  const datasetRegex = datasetId
    ? new RegExp(`<Dataset[^>]*id=["']${datasetId}["'][^>]*>([\\s\\S]*?)<\\/Dataset>`, "i")
    : /<Dataset[^>]*>([\s\S]*?)<\/Dataset>/i;

  const dsMatch = xmlText.match(datasetRegex);
  if (!dsMatch) return [];
  const datasetXml = dsMatch[1];

  // ColumnInfo 순서 확보 (id 속성 없는 Col 응답 대비 fallback)
  const columnIds = [];
  const columnInfoMatch = datasetXml.match(/<ColumnInfo>([\s\S]*?)<\/ColumnInfo>/i);
  if (columnInfoMatch) {
    const colInfoRegex = /<Column[^>]*id=["']([^"']+)["'][^>]*\/?>/gi;
    let m;
    while ((m = colInfoRegex.exec(columnInfoMatch[1])) !== null) {
      columnIds.push(m[1]);
    }
  }

  const rowsMatch = datasetXml.match(/<Rows>([\s\S]*?)<\/Rows>/i);
  if (!rowsMatch) return [];

  const records = [];
  const rowRegex = /<Row>([\s\S]*?)<\/Row>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(rowsMatch[1])) !== null) {
    const rowXml = rowMatch[1];
    const record = {};

    const colWithIdRegex = /<Col[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Col>/gi;
    let colMatch;
    let matchedAny = false;
    while ((colMatch = colWithIdRegex.exec(rowXml)) !== null) {
      matchedAny = true;
      record[colMatch[1]] = decodeXmlEntities(colMatch[2].trim());
    }

    if (!matchedAny) {
      const plainColRegex = /<Col[^>]*>([\s\S]*?)<\/Col>/gi;
      let plainMatch;
      let idx = 0;
      while ((plainMatch = plainColRegex.exec(rowXml)) !== null) {
        const key = columnIds[idx] || `col_${idx}`;
        record[key] = decodeXmlEntities(plainMatch[1].trim());
        idx++;
      }
    }

    records.push(record);
  }

  return records;
}

/**
 * ERP 본문 필드(ctnt3/ctnt4/ctnt6 등)는 HTML 엔티티 인코딩 + 태그가 섞인 리치텍스트로
 * 내려온다. 엔티티 디코딩 후 태그를 제거해 평문으로 만든다. DOM 없이 동작.
 *
 * ⚠️ 2026-08-19: 실제 응답 마크업을 확인하지 않고 <table>/<td>를 "|"로 구분하는
 * 로직을 추측으로 넣었다가, 실제로는 그 태그 구조가 예상과 달라서 오히려 줄바꿈이
 * 전부 사라지고 한 줄로 뭉개지는 회귀가 발생함(실사용 중 발견, 되돌림). 표/목록
 * 태그도 </p>/<br>처럼 "닫는 태그 = 줄바꿈"이라는 안전한 규칙만 적용하도록 축소함 —
 * 이건 최소한 기존 동작보다 나빠질 수 없음(어떤 마크업이든 줄바꿈만 추가될 뿐,
 * 지우진 않음). 셀을 "|"로 나란히 붙이는 표 형태는 실제 마크업을 다시 캡처해서
 * 검증한 뒤에 별도로 재작업할 것 (RAW_TEXT_EXTRACT_VERSION만 다시 올리면 기존
 * 저장된 문서도 자동으로 재추출됨).
 * @param {string} html
 * @returns {string}
 */
export function decodeRichText(html) {
  if (!html) return "";
  const decoded = decodeXmlEntities(html);
  return decoded
    .replace(/<\/tr\s*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 협조문 상세(findIntAprvDtlList.do) 응답 Row 하나에서 본문 원문을 뽑아낸다.
 * (2026-08-19 실측 근거는 위쪽 큰 주석 참고) ctnt1~ctnt8을 순서대로 확인해서
 * 값이 있는 필드를 전부 이어붙인다 — 한 문서가 여러 필드에 나뉘어 들어오는
 * 경우(예: ctnt3=본문, ctnt4=제출안내)가 실측으로 확인됐기 때문에 첫 번째
 * 매치만 쓰면 내용이 잘린다.
 *
 * ⚠️ 2026-08-19 실측 정정: 처음엔 ctnt{i}Tmp(서버가 태그 제거해준 평문)를 원본
 * HTML보다 우선했는데, 실제 응답을 열어보니 Tmp는 <table>/<td>/<p> 등 블록
 * 경계를 전혀 안 지키고 그냥 모든 텍스트를 공백으로만 이어붙인 것이었음(표가
 * 있는 문서는 완전히 뭉개진 한 줄이 됨). 그래서 우선순위를 뒤집어서 원본
 * HTML(ctnt{i})을 decodeRichText로 변환하는 쪽을 우선 쓰고, HTML이 없을 때만
 * (드물게 Tmp만 오는 경우 대비) Tmp로 폴백한다.
 * @param {Object} detail  fetchCoopDocDetail() 결과 배열의 Row 하나
 * @returns {string} 여러 필드를 "\n\n"으로 이어붙인 원문. 아무 필드도 없으면 ""
 */
// "사업개요/머리글" 필드용 후보 — 2026-08-22, 우진이 지적한 대로 기안 화면에서
// "사업개요/머리글"에다 내용을 다 쓰는 사람과 "주요내용"(가.나.다...)에 나눠
// 쓰는 사람이 갈려서, 문서마다 본문이 어느 필드에 들어있는지가 다르다.
// findIntAprvDtlList.do의 ColumnInfo에 선언된 필드 중 후보로 보이는 걸 우선
// 순위대로 시도 — 아직 실측으로 값이 채워진 예시는 못 봤지만(이번 건설기술인
// 문서는 이것도 다 비어있었음), ctnt1/ctnt2가 항상 비어있던 미스터리의 답이
// 여기 있을 수 있어서 같이 확인해본다. 문서 구조상 "머리글"이 "주요내용"보다
// 앞에 오므로 ctnt1~8보다 먼저 이어붙인다.
const HEADER_CTNT_FIELDS = ["basiCtnt", "intAprvCtnt", "coopCtnt"];

export function extractDetailText(detail) {
  if (!detail) return "";
  const parts = [];
  for (const field of HEADER_CTNT_FIELDS) {
    const value = detail[field];
    if (value) parts.push(decodeRichText(value));
  }
  for (let i = 1; i <= 8; i++) {
    const value = detail[`ctnt${i}`] || detail[`ctnt${i}Tmp`];
    if (value) parts.push(decodeRichText(value));
  }
  return parts.join("\n\n").trim();
}

/**
 * decodeRichText는 표를 결국 줄바꿈으로만 나열해서 "표처럼 보이진" 않는다
 * (실사용 피드백: "그래도 표는 안 만들어지네"). 진짜 <table>로 렌더링하고
 * 싶으면 태그 구조 자체를 살려야 하는데, 실측해보니 ctnt 필드 원본 HTML엔
 * style/class/div 등 잡다한 속성이 잔뜩 붙어있어서(구글독스 붙여넣기 특유의
 * 마크업) 그대로 렌더링하면 레이아웃이 깨진다. 그래서 태그 이름만 허용
 * 목록으로 걸러서 속성은 다 제거하고, table/tr/td 같은 "구조" 태그만 남긴
 * 안전한 HTML 문자열을 만든다. DOM 없이 정규식으로 처리 가능 (속성만
 * 벗겨내는 거라 태그 중첩 구조는 원본 그대로 유지됨).
 * @param {string} html
 * @returns {string} table/tr/td 등 구조 태그만 남은 HTML (렌더링용, dangerouslySetInnerHTML 대상)
 */
const ALLOWED_HTML_TAGS = new Set([
  "table", "thead", "tbody", "tr", "td", "th", "colgroup", "col",
  "p", "br", "b", "strong", "ul", "ol", "li", "div", "span",
]);

// td/th는 colspan·rowspan을 지워버리면 병합된 셀 구조가 깨져서 표가
// "여기저기 밀려 보이는" 원인이 됨(2026-08-22 레이아웃 정리 피드백) — 이
// 두 속성만 예외적으로 살린다. 그 외(style/class/width 등)는 여전히 전부 제거.
const PRESERVED_ATTRS_BY_TAG = {
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

export function sanitizeRichHtml(html) {
  if (!html) return "";
  const decoded = decodeXmlEntities(html);
  return decoded
    .replace(/<(\/?)([a-zA-Z0-9]+)((?:\s[^>]*)?)\/?>/g, (match, closing, tagName, attrsStr) => {
      const lower = tagName.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(lower)) return ""; // 허용 안 된 태그(span 안의 style 등) 마커만 제거, 내용은 유지
      if (closing || !PRESERVED_ATTRS_BY_TAG[lower]) return `<${closing}${lower}>`;
      let kept = "";
      for (const attr of PRESERVED_ATTRS_BY_TAG[lower]) {
        const m = attrsStr.match(new RegExp(`${attr}\\s*=\\s*["']?(\\d+)["']?`, "i"));
        if (m) kept += ` ${attr}="${m[1]}"`;
      }
      return `<${lower}${kept}>`;
    })
    // Nexacro 리치텍스트 편집기가 습관적으로 넣는 빈 문단(<p><br></p>, <p></p>)과
    // 연속 <br>이 문단 사이 간격을 들쭉날쭉하게 만듦 — 하나로 눌러서 간격을 균일하게.
    .replace(/<p>\s*(?:<br>\s*)*<\/p>/gi, "")
    .replace(/(?:<br>\s*){2,}/gi, "<br>")
    .trim();
}

// 2026-08-22: 본문에 구글드라이브 링크 같은 URL이 그냥 평문으로 박혀있는
// 경우가 실측 확인됨(예: "교육자료 및 가이드북 구글 드라이브 링크\nhttps://...") —
// sanitizeRichHtml이 <a> 태그를 아예 허용 목록에서 뺐었어서(구조 태그만 허용)
// 원본에 진짜 <a href>가 있었어도 다 벗겨졌을 것이고, 애초에 그냥 텍스트로만
// 적힌 경우도 많아서 <a> 허용만으론 부족함. 그래서 최종 문자열에서 URL처럼
// 생긴 부분을 정규식으로 찾아 직접 <a>로 감싸는 방식으로 처리(원본에 진짜
// 앵커가 있었는지와 무관하게 항상 동작).
const URL_PATTERN = /(https?:\/\/[^\s<>"'\)]+)/g;
// URL 뒤에 붙은 문장부호(마침표/쉼표/괄호닫힘 등)는 링크에서 빼고 원래 자리로
// 돌려놓음 — 안 그러면 "...FVQT." 처럼 마침표까지 링크에 포함돼버림.
const URL_TRAILING_PUNCT = /[.,;:)\]}]+$/;

// 2026-08-22: raw_html이 있는 문서는 실측 확인 결과 ctnt{i}Tmp 폴백 경로로 만든
// <p>가 원본 줄바꿈 단위 그대로 한 줄에 <p> 하나씩 붙는 구조였음 — 그래서
// "1)/2)/3)/4)"와 그 하위 "-"/"※" 줄이 전부 [&_p]:my-1.5로 똑같은 간격만
// 받고 들여쓰기·문단 구분이 전혀 안 됐던 것("들여쓰기 아직인거 같다" 피드백의
// 진짜 원인 — raw_text 쪽 FormattedBody 로직은 raw_html이 있으면 아예 안 쓰임).
// raw_text용으로 만든 번호/하위항목 판별 정규식을 여기서도 그대로 재사용해서
// <p> 태그 각각에 inline style로 여백·들여쓰기를 직접 박아 넣는다(React 쪽
// [&_p] 유틸 클래스는 그대로 두되, 인라인 style이 우선순위가 더 높아 개별
// <p>마다 다르게 적용 가능).
// 2026-08-22 추가 실측(경북가족장학 문서): "다./라./마." 같은 한글 자모
// 제목 바로 아래 "-"로 시작하는 설명줄은 제목 서식 안내문일 뿐이라 들여쓰기
// 없이 제목과 같은 레벨로 둬야 하고, 그 아래 나오는 "1./2./3..." 번호 목록만
// 진짜 하위항목이라 들여쓰기해야 함(우진 피드백: "가나다 부분 하단에 -로
// 되어있는건 동일 라인으로, 그 밑에 번호 나와있는건 들여쓰기로"). 그래서
// 단순 정규식 매칭이 아니라 "직전에 본 게 (아직 번호 목록이 안 나온) 한글
// 제목인가"를 순서대로 추적하는 상태 기반 처리로 바꿈.
const HTML_LETTER_HEADING = /^[가나다라마바사아자차카타파하]\.\s/;
const HTML_BLOCK_START = /^\d+[)\.]\s/;
const HTML_SUB_ITEM = /^[-－–—•·※*]\s/;

function formatParagraphs(html) {
  if (!html) return html;
  // sawHeading: 문서 안에서 "가./나./다." 제목을 한 번이라도 봤으면 true로
  // 계속 유지 — 그 뒤에 나오는 번호 목록은 전부 그 제목의 하위항목이라
  // 들여쓰기 대상. 헤딩이 아예 없는 문서(예: "1)/2)/3)"만 있는 경우)는
  // 번호 목록 자체가 최상위라 들여쓰기하면 안 됨(우진 피드백 반영 전 원래
  // 동작 유지) — 그래서 "헤딩을 본 적 있는지"로 들여쓰기 여부를 가른다.
  let sawHeading = false;
  let afterHeadingNoNumberYet = false;
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (match, inner) => {
    const textStart = inner.replace(/<[^>]+>/g, "").trimStart();
    let style;
    if (HTML_LETTER_HEADING.test(textStart)) {
      style = "margin:0.9rem 0 0.25rem;font-weight:500;";
      sawHeading = true;
      afterHeadingNoNumberYet = true;
    } else if (HTML_BLOCK_START.test(textStart)) {
      const indent = sawHeading ? "1rem" : "0";
      style = `margin:0.75rem 0 0.25rem;padding-left:${indent};`;
      afterHeadingNoNumberYet = false;
    } else if (HTML_SUB_ITEM.test(textStart)) {
      if (afterHeadingNoNumberYet) {
        // 제목 바로 아래 붙은 설명줄 — 들여쓰기 없이 제목과 같은 레벨
        style = "margin:0.125rem 0;";
      } else {
        const indent = sawHeading ? "2rem" : "1rem";
        style = `margin:0.125rem 0;padding-left:${indent};`;
      }
    } else {
      style = "margin:0.375rem 0;";
      afterHeadingNoNumberYet = false;
    }
    return `<p style="${style}">${inner}</p>`;
  });
}

function linkifyHtml(html) {
  if (!html) return html;
  return html.replace(URL_PATTERN, (url) => {
    const trailMatch = url.match(URL_TRAILING_PUNCT);
    const trail = trailMatch ? trailMatch[0] : "";
    const cleanUrl = trail ? url.slice(0, -trail.length) : url;
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline break-all">${cleanUrl}</a>${trail}`;
  });
}

/**
 * extractDetailText의 HTML 버전 — 표를 실제 <table>로 렌더링하고 싶을 때 사용.
 * (2026-08-19 추가, 실사용 피드백 반영) 여러 ctnt 필드를 <hr>로 구분해 이어붙인다.
 * @param {Object} detail
 * @returns {string}
 */
export function extractDetailHtml(detail) {
  if (!detail) return "";
  const parts = [];
  for (const field of HEADER_CTNT_FIELDS) {
    const value = detail[field];
    if (value) parts.push(sanitizeRichHtml(value));
  }
  for (let i = 1; i <= 8; i++) {
    const htmlValue = detail[`ctnt${i}`];
    if (htmlValue) {
      parts.push(sanitizeRichHtml(htmlValue));
      continue;
    }
    // ⚠️ 2026-08-22 실측 확인(aprvNo 00131407의 ctnt4): 원본 HTML(ctnt{i})은
    // 없고 태그 제거된 평문(ctnt{i}Tmp)만 있는 경우가 실제로 있음. extractDetailText는
    // 이 경우 Tmp로 폴백해서 raw_text엔 잡히는데, 여기(HTML 버전)는 그동안 폴백이
    // 없어서 raw_html엔 안 잡혔었다 — 모달이 raw_html 있으면 그걸 우선 렌더링하는
    // 구조라 이 내용이 화면에서 통째로 사라지는 버그였음("2.관련 같은 문단이 계속
    // 빠져 보인다"는 피드백의 원인 중 하나로 확인). Tmp는 진짜 태그가 없는 평문이라
    // 표/줄바꿈 구조는 못 살리지만, 최소한 이스케이프해서 한 문단으로라도 보여준다.
    const tmpValue = detail[`ctnt${i}Tmp`];
    if (tmpValue) {
      const escaped = decodeXmlEntities(tmpValue)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      parts.push(`<p>${escaped}</p>`);
    }
  }
  return linkifyHtml(formatParagraphs(parts.join('<hr>')));
}

/**
 * AI 요약(ai_summary) 없이도 카드에 뭔가 보여주기 위한 non-AI 폴백 요약.
 * ⚠️ 2026-08-22: proxy/(Cloudflare Worker) 배포 전이라 claudeApi.js의
 * parseCoopDoc이 항상 실패하고, ai_summary는 실사용 중 계속 빈 문자열임
 * (카드에 요약 줄이 아예 안 뜨는 원인). 프록시 배포 전까지 최소한의 대체
 * 수단으로, raw_text 앞부분을 다듬어서 짧게 잘라 보여준다 — AI 요약이 아니라
 * 원문 발췌라 정확도는 raw_text 품질에 의존함.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function roughExcerpt(text, maxLen = 160) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen).trim()}…`;
}

/**
 * 문자열의 연속 2글자(bigram) 집합. stripTitleDuplicate의 유사도 비교용.
 * @param {string} s
 * @returns {Set<string>}
 */
function charBigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * 두 문자열의 bigram 기준 자카드 유사도 (0~1).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function bigramSimilarity(a, b) {
  const setA = charBigrams(a);
  const setB = charBigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const bg of setA) if (setB.has(bg)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/**
 * 본문(body) 앞부분에서 제목(title)과 "거의 같은" 구간을 찾아 제거한다.
 * ⚠️ 2026-08-22 첫 시도(indexOf로 정확히 일치하는 구간만 찾기)는 실패했음 —
 * 실측: ERP 본문이 제목을 토씨 하나 안 틀리고 반복하는 게 아니라 단어 하나가
 * 빠지는 등 미묘하게 달랐음(예: 제목 "국가근로장학" vs 본문 "국가근로") — 그래서
 * indexOf가 매칭을 못 찾아 중복이 그대로 남아있었음("혹시 바꾼거 맞아?" 확인
 * 결과 재현됨). bigram 유사도로 본문 앞부분(offset 0~60)을 title 길이만큼 슬라이딩
 * 하며 가장 비슷한 구간을 찾고, 유사도 0.5 이상이면 그 구간을 통째로 잘라낸다 —
 * 한두 글자 차이는 허용하면서도 완전히 다른 문장을 잘못 지우는 건 방지.
 * @param {string} body
 * @param {string} title
 * @returns {string}
 */
function stripTitleDuplicate(body, title) {
  if (!title || title.length < 8) return body;
  const searchRange = Math.min(60, Math.max(0, body.length - title.length));
  let best = { score: 0, offset: -1 };
  for (let offset = 0; offset <= searchRange; offset++) {
    const window = body.slice(offset, offset + title.length);
    if (window.length < title.length * 0.8) break;
    const score = bigramSimilarity(title, window);
    if (score > best.score) best = { score, offset };
  }
  if (best.score >= 0.5) {
    return (body.slice(0, best.offset) + body.slice(best.offset + title.length))
      .replace(/\s+/g, " ")
      .trim();
  }
  return body;
}

/**
 * roughExcerpt보다 한 단계 더 다듬은 non-AI 더미 요약. 2026-08-22: roughExcerpt가
 * raw_text 맨 앞을 그냥 잘라서 보여주다 보니, 카드 제목과 거의 똑같은 문장이
 * 요약 줄에도 그대로 반복되는 경우가 많았다(ERP 협조문 본문이 흔히 제목 문장으로
 * 시작함) — "본문 그대로 가져오는 것 같다"는 피드백의 원인. 진짜 AI 요약이 아니라
 * 어디까지나 휴리스틱 더미지만, 최소한 (1) 본문 앞부분에 제목과 겹치는 문장이
 * 있으면 제거하고(stripTitleDuplicate, 완전 일치가 아니어도 bigram 유사도로 판단)
 * (2) "1)", "2)" 같은 번호 목록 앞에 구분자를 넣어 읽기 쉽게 다듬는다. ai_summary가
 * 채워지면(프록시 배포 후) 이 함수는 안 쓰이게 되므로(CoopCard.jsx의
 * `doc.ai_summary || mockSummarize(doc)` 구조) 별도 교체 작업 없이 자동으로 진짜
 * AI 요약으로 바뀐다.
 * @param {{title?: string, raw_text?: string}} doc
 * @returns {string}
 */
export function mockSummarize(doc) {
  const raw = doc?.raw_text || "";
  if (!raw) return "";
  let body = raw.replace(/\s+/g, " ").trim();
  const title = (doc?.title || "").replace(/\s+/g, " ").trim();
  body = stripTitleDuplicate(body, title);
  body = body.replace(/(\d\))/g, " · $1").replace(/\s+/g, " ").trim();
  return roughExcerpt(body, 150);
}

// ---------------------------------------------------------------------------
// fetch 래퍼 + API 호출 함수
// ---------------------------------------------------------------------------

/**
 * 실패 시 1회 재시도하는 fetch 래퍼. (코딩 규칙: fetch 실패 시 1회 재시도,
 * 그래도 실패하면 에러를 던짐 — 토스트 표시는 호출부인 background.js 책임)
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [retries]
 */
async function fetchWithRetry(url, options, retries = 1) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`ERP 요청 실패: ${res.status} ${res.statusText}`);
    return res;
  } catch (err) {
    if (retries > 0) {
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

/**
 * @param {{path: string, menuId: string|null, pgmId: string|null}} endpoint
 * @param {string} requestDatasetId  요청 Dataset id (보통 "DS_COND")
 * @param {Object<string,string>} params
 * @param {string[]} [columnSchema]
 * @param {string} [responseDatasetId]  응답에서 파싱할 Dataset id. 생략 시 응답의 첫
 *   Dataset을 그대로 씀 — 협조문수신함처럼 응답 Dataset id가 요청과 다른 경우
 *   (DS_COND로 요청 → DS_BSNS052로 응답) 반드시 명시할 것.
 */
async function postDataset(endpoint, requestDatasetId, params, columnSchema, responseDatasetId, _isRetry = false) {
  const body = buildXmlRequest(requestDatasetId, params, columnSchema);

  const query = new URLSearchParams();
  if (endpoint.menuId) query.set("menuId", endpoint.menuId);
  if (endpoint.pgmId) query.set("pgmId", endpoint.pgmId);
  const queryString = query.toString();
  const url = `${BASE_URL}${endpoint.path}${queryString ? `?${queryString}` : ""}`;

  if (!endpoint.menuId || !endpoint.pgmId) {
    console.warn(
      `[kisApi] ${endpoint.path}: menuId/pgmId가 아직 미검증 상태로 호출됨. ` +
        `실패하면 Network 탭에서 캡처해서 ENDPOINTS에 채워넣을 것.`
    );
  }

  const res = await fetchWithRetry(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body,
  });
  const text = await res.text();

  // ⚠️ 2026-08-19 실사용 중 발견: ERP 세션이 만료되면 서버가 HTTP 에러가 아니라
  // 로그인 페이지(HTML)를 200 OK로 돌려주는 경우가 있다. 이걸 그냥 parseXmlResponse에
  // 넘기면 <Dataset>을 못 찾아 조용히 빈 배열([])을 반환하고, background.js는
  // "정상 폴링, 새 문서 없음"으로 착각한 채 계속 돈다 — 세션이 죽은 채로 몇 시간이고
  // 아무 에러 로그 없이 방치되는 원인이었음(10시간 방치 후 로그아웃된 실사용 사례로
  // 발견). 응답이 Dataset XML 형태가 아니면 명확히 에러로 처리해서 호출부가 감지할
  // 수 있게 한다.
  // ⚠️ 2026-08-23 추가: fetchWithRetry는 네트워크 레벨 실패(fetch 자체가 던지거나
  // res.ok가 false인 경우)만 재시도하고, "200은 왔는데 Dataset이 아닌 본문"은
  // 재시도 없이 바로 여기서 에러가 됐었다. 근데 실사용 중 확인해보니 세션이
  // 멀쩡히 살아있는데도 ERP 서버가 순간적으로 이상한 응답(빈 페이지, 일시적 라우팅
  // 오류 등)을 주는 경우가 있어서, 이걸 곧바로 "세션 만료"로 단정하면 오탐이 잦다.
  // 그래서 이 케이스도 한 번은 재시도해보고, 재시도까지 똑같이 Dataset이 아니면
  // 그때 진짜 세션 만료로 판단한다 — 진짜 세션이 죽은 거면 재시도해도 어차피
  // 똑같이 로그인 페이지가 내려올 것이므로 결과는 같고, 일시적 hiccup인 경우만
  // 구제된다.
  if (!/<Dataset[\s>]/i.test(text)) {
    if (!_isRetry) {
      // ⚠️ 2026-08-23(11): 실사용 중 "실제로 로그아웃 안 됐는데도 세션 만료
      // 알림이 뜬다"는 리포트로 추가 — 바로 재시도하면 서버가 아직 같은
      // 일시적 hiccup 상태일 수 있어서(즉시 재시도라 거의 동시 요청), 잠깐
      // 텀을 두고 재시도하면 그 사이 hiccup이 풀렸을 가능성이 더 커진다.
      // 진짜 세션 만료라면 0.8초 기다렸다 재시도해도 결과는 어차피 똑같다.
      await new Promise((resolve) => setTimeout(resolve, 800));
      return postDataset(endpoint, requestDatasetId, params, columnSchema, responseDatasetId, true);
    }
    const err = new Error("ERP 응답이 예상한 Dataset XML이 아님 (세션 만료로 로그인 페이지가 내려왔을 가능성)");
    err.code = "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    err.responseSnippet = text.slice(0, 300);
    throw err;
  }

  return parseXmlResponse(text, responseDatasetId);
}

/**
 * postDataset과 별개로, <Parameters>만 채워서 보내는 API용 (findFileDetailList.do 등,
 * 2026-08-21 팀원 실측). 헤더도 목록/상세 API와 달리 Content-Type: text/plain +
 * 커스텀 헤더 Reqfoundataion: nexacro가 필요한 것으로 확인됨 — postDataset의
 * text/xml 헤더로는 이 엔드포인트가 빈 응답을 줬었음(실측: findSavedAttachDocList.do
 * 오엔드포인트 문제였을 수도 있지만, 팀원 쪽 확인된 조합을 그대로 따름).
 * @param {{path: string, menuId: string|null, pgmId: string|null}} endpoint
 * @param {Object<string,string>} params
 * @param {string} [responseDatasetId]
 */
async function postParamsOnly(endpoint, params, responseDatasetId) {
  const body = buildParamsOnlyXmlRequest(params);

  const query = new URLSearchParams();
  if (endpoint.menuId) query.set("menuId", endpoint.menuId);
  if (endpoint.pgmId) query.set("pgmId", endpoint.pgmId);
  const queryString = query.toString();
  const url = `${BASE_URL}${endpoint.path}${queryString ? `?${queryString}` : ""}`;

  const res = await fetchWithRetry(url, {
    method: "POST",
    credentials: "include",
    referrer: `${BASE_URL}/nx/index.html`,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Reqfoundataion": "nexacro",
    },
    body,
  });
  const text = await res.text();

  if (!/<Dataset[\s>]/i.test(text)) {
    const err = new Error("ERP 응답이 예상한 Dataset XML이 아님 (세션 만료로 로그인 페이지가 내려왔을 가능성)");
    err.code = "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    err.responseSnippet = text.slice(0, 300);
    throw err;
  }

  return parseXmlResponse(text, responseDatasetId);
}

/**
 * 협조문수신함 화면으로 바로 이동하는 ERP URL. (2026-08-19 실측 완료)
 * kis.kbu.ac.kr은 Nexacro SPA라 특정 "문서" 하나로 딥링크하는 건 안 됨 —
 * `?menuId=...&pgmId=...&aprvNo=...`처럼 aprvNo를 붙여봐도 그냥 목록 화면만
 * 뜨고 자동으로 팝업이 열리진 않음(실측 확인). 대신 menuId/pgmId 쿼리스트링만
 * 붙이면 메뉴 트리를 안 타고 협조문수신함 "화면"으로는 바로 이동됨 — 그 정도가
 * 지금 가능한 최선이라, 사용자가 화면에서 직접 문서를 찾아 클릭해야 함.
 * @returns {string}
 */
export function getCoopDocListUrl() {
  const { menuId, pgmId } = ENDPOINTS.coopDocList;
  return `${BASE_URL}/nx/index.html?menuId=${menuId}&pgmId=${pgmId}`;
}

/**
 * 협조문수신함 목록. (2026-08-08 실측 완료 — 요청 Dataset "DS_COND" →
 * 응답 Dataset "DS_BSNS052"로 이름이 바뀜에 유의. 응답 Col 필드: subject/deptNm/
 * stGbn/draftEmpNm/draftDt/docDivNm/aprvNo/attachNo/cfmYn 등 40개. 값 없는
 * 필드는 Col 자체가 생략됨 — record에 해당 key가 아예 없을 수 있으니 소비하는
 * 쪽(background.js)에서 옵셔널 체이닝 필수. 공백은 &#32; 숫자 엔티티로 내려옴
 * (decodeXmlEntities가 처리함).
 *
 * ⚠️ 2026-08-21 실측 정정: stGbn/docDeptCd를 빈 값으로 보내면 "전사문서열람"
 * (전체 부서)으로 조회됨 — 실제 "협조문수신함 > 부서" 탭에서 캡처한 요청은
 * stGbn="03", docDeptCd="60600000"을 채워서 보냄(우진 계정 기준 실측).
 * 2026-08-22(15): docDeptCd 기본값을 우진 계정 코드로 하드코딩해뒀던 걸
 * 제거 — 어차피 이 함수의 유일한 호출부(fetchCoopDocListAllDepts)가 항상
 * docDeptCd를 명시적으로 넘기므로 기본값은 안 쓰이지만, 다른 계정이 이 함수를
 * 직접 호출할 경우를 대비해 빈 값(전사문서열람 모드)으로 바꿔둠.
 * @param {{stGbn?: string, docDeptCd?: string}} params 상태구분 / 부서코드
 */
export function fetchCoopDocList({ stGbn = "03", docDeptCd = "" } = {}) {
  return postDataset(
    ENDPOINTS.coopDocList,
    "DS_COND",
    { stGbn, docDeptCd },
    COOP_DOC_LIST_SCHEMA,
    "DS_BSNS052"
  );
}

/**
 * 로그인 계정의 소속 부서 목록("최근 1년 발령 부서" 전부). (2026-08-22 실측
 * 완료 — POST /com/UmgjCtr/findPersOfrdDeptList.do, 응답 Dataset "DS_DEPT",
 * Col deptCd/deptNm.) deptNm에 "혁신지원사업단(60600000)"처럼 코드가 괄호로
 * 붙어서 오길래 표시용으로 떼어냄.
 *
 * ⚠️ 예전엔 이 목록을 화면 캡처로 손으로 옮겨써서 MY_DEPARTMENTS라는 상수로
 * 하드코딩했었는데(우진 계정 기준), 그러면 다른 계정으로 이 확장을 쓰는 사람은
 * 전혀 다른 부서 코드가 필요해서 협조문이 하나도 안 뜨는 문제가 있었음. 이제
 * 이 API로 매번 실시간 조회해서 계정마다 자동으로 맞는 부서 목록을 가져온다.
 * @returns {Promise<Array<{code: string, name: string}>>}
 */
export async function fetchPersOfrdDeptList() {
  const rows = await postDataset(ENDPOINTS.persOfrdDeptList, "DS_COND", {}, undefined, "DS_DEPT");
  return rows
    .filter((r) => r.deptCd)
    .map((r) => ({
      code: r.deptCd,
      name: (r.deptNm || r.deptCd).replace(/\s*\(\d+\)\s*$/, ""),
    }));
}

/**
 * 협조문수신함 전체 목록 조회.
 *
 * ⚠️ 2026-08-23 재작성: 예전엔 fetchPersOfrdDeptList()로 소속 부서(우진 계정
 * 기준 6개)를 받아와 부서마다 순차로 fetchCoopDocList를 호출해 합치는
 * 구조였다. 근데 바로 위 주석에 있던 2026-08-22 실측으로 이미 "docDeptCd
 * 파라미터는 실제 목록 필터링에 별 영향이 없다(부서를 바꿔도 거의 동일한
 * 문서 목록이 옴)"는 걸 확인해뒀었는데도, 그 6번 순차 호출 구조를 그대로
 * 남겨뒀던 게 문제였음 — 5분 폴링마다 ERP에 요청을 6개씩 연달아 쏘고, 그중
 * 단 하나라도 일시적으로(네트워크 지연, ERP 서버 순간 hiccup 등) 이상 응답을
 * 주면 postDataset이 이걸 "세션 만료"로 판단해서 전체 폴링을 중단시켰다.
 * 실제로는 로그인이 멀쩡히 유지되고 있는데도 "ERP 로그인 세션 만료" 알림이
 * 반복적으로 뜨는 원인이 바로 이거였을 가능성이 큼(우진 본인 계정에서도
 * 재현됨 — 세션 자체 문제가 아니라 요청 6개 중 하나가 삐끗한 것뿐이었을 수
 * 있음). docDeptCd가 필터링에 영향이 없다는 게 이미 실측 확인된 이상 부서를
 * 순회할 이유가 없어서, 전사문서열람 모드(docDeptCd 빈 값)로 딱 1번만
 * 호출하도록 단순화함 — 요청 수가 1/6로 줄어서 이런 식의 오탐 가능성 자체가
 * 크게 준다. fetchPersOfrdDeptList()는 더 이상 이 경로에서 안 쓰지만, 나중에
 * 진짜 부서별 분류가 다시 필요해질 수도 있어서 함수 자체는 남겨둔다.
 *
 * ⚠️⚠️ 5단계 병합 시 발견한 충돌(중요, 팀 확인 필요): kbu-assistant
 * background.js 쪽 실측 코멘트는 반대로 "docDeptCd=''(기본) 조회와
 * docDeptCd='29900023'처럼 명시한 조회가 서로 다른 결과를 준다"(2026-08-22,
 * W님 계정 — 기본 조회엔 없던 기획처발 문서가 특정 코드 조회에만 나옴)고
 * 적혀있다. 즉 "docDeptCd는 필터링에 영향 없음"(이 파일, 2026-08-23)과
 * "docDeptCd에 따라 결과가 달라짐"(kbu, 2026-08-22)이 정면으로 부딪힌다.
 * 두 관찰 다 실측이라고 적혀있는데, 계정별로 ERP 권한/부서 매핑이 달라서
 * 결과가 다르게 보였을 가능성이 있다 — 병합하면서 이 차이를 임의로 한쪽
 * 결론으로 덮지 않고, 아래처럼 "부서코드 자동 수집은 하되(정보 제공용),
 * 매 폴링마다 여러 번 쿼리하는 건 하지 않는" 절충안으로 구현해뒀다. 실사용
 * 중 "특정 부서로만 오는 협조문이 안 보인다"는 리포트가 실제로 나오면,
 * discoveredDeptCodes에 없는 부서가 있는지부터 확인하고 그때 다시 여러 쿼리
 * 구조로 되돌릴지 판단할 것.
 * @returns {Promise<Array<Object>>}
 */
export async function fetchCoopDocListAllDepts() {
  const items = await fetchCoopDocList({ docDeptCd: "" });
  // 5단계(kbu-assistant "부서코드 자동 발견" 이식, 안전한 형태로): 매 폴링마다
  // 추가 쿼리를 보내는 대신, 이미 받은 응답에서 rcvDeptCd/rcvDeptNm만 모아서
  // db.js meta에 기록해둔다. SettingsPage의 "겸직 부서 코드" 목록이 이 값을
  // 참고용으로 보여줘서, 사람이 ERP 화면에서 부서 코드를 직접 찾아 헤매지
  // 않고 실제로 문서가 온 부서 코드를 바로 확인/등록할 수 있게 한다.
  recordDiscoveredDeptCodes(items).catch((err) =>
    console.warn("[kisApi] 부서코드 자동 수집 실패(무시 가능):", err)
  );
  return items;
}

/**
 * fetchCoopDocListAllDepts 응답에서 rcvDeptCd/rcvDeptNm 조합을 모아
 * db.js meta("discoveredDeptCodes")에 누적 저장한다. ERP를 추가로 조회하지
 * 않고 이미 받은 응답만 재사용하므로 네트워크 요청이 늘지 않는다.
 * @param {Array<Object>} items
 */
async function recordDiscoveredDeptCodes(items) {
  const found = new Map();
  for (const item of items) {
    if (item.rcvDeptCd) found.set(item.rcvDeptCd, item.rcvDeptNm || item.rcvDeptCd);
  }
  if (found.size === 0) return;

  const prev = (await getMeta("discoveredDeptCodes")) || [];
  const merged = new Map(prev.map((d) => [d.code, d.name]));
  for (const [code, name] of found) merged.set(code, name);
  const list = Array.from(merged, ([code, name]) => ({ code, name }));
  await setMeta("discoveredDeptCodes", list);
}

/**
 * ERP 협조문수신함 응답을 그대로 반환한다.
 * 소속/발령 부서(DS_DEPT)는 수신 가능한 부서 전체가 아니다.
 * 수신 행의 rcvDeptCd를 소속 또는 수동 부서 목록으로 제한하면
 * 겸직/이전 조직 등으로 수신한 정상 문서가 저장 전에 누락된다.
 * 조회 조건과 서버의 세션 권한은 기존 협조문수신함 요청을 유지한다.
 */
export async function fetchMyCoopDocList() {
  return fetchCoopDocListAllDepts();
}

/** 지출출장결재현황 목록(내가 기안한 것). 별도 필터 없이 세션 컨텍스트로 호출됨. */
export function fetchExpenseTravelList() {
  return postDataset(ENDPOINTS.expenseTravelList, "DS_COND", {});
}

/**
 * 내부기안결재현황 목록.
 * @param {{stGbn?: string}} params 상태구분
 */
export function fetchInternalDraftList({ stGbn = "" } = {}) {
  return postDataset(ENDPOINTS.internalDraftList, "DS_COND", { stGbn });
}

/**
 * 지출출장결재하기 목록 — 나에게 결재 요청이 올라온 것들(fetchExpenseTravelList
 * 처럼 "내가 기안한 것"이 아니라 반대 방향). 2026-08-23 추가.
 * stGbn="02"가 진행(결재 대기중) 상태 — 별도 프로토타입에서 실측 확인된 값을
 * 그대로 사용. (⚠️ 이 화면 자체는 menuId/pgmId까지 실측된 값이지만, 우진
 * 계정이 아닌 다른 계정에서도 stGbn="02"가 똑같이 "대기중"을 뜻하는지는
 * 아직 재검증 안 됨 — 다르게 동작하면 Network 탭에서 재확인할 것)
 * @param {{stGbn?: string}} params 상태구분
 */
export function fetchApprovalPendingList({ stGbn = "02" } = {}) {
  return postDataset(ENDPOINTS.aprvMngList, "DS_COND", { stGbn });
}

/**
 * 로그인 사용자 이름. (2026-08-22 실측 완료 — POST /com/SsoCtr/isLogin.do,
 * 응답 Row에 Col id="userNm")
 * @returns {Promise<string|null>}
 */
export async function fetchLoginUserName() {
  const rows = await postDataset(ENDPOINTS.isLogin, "DS_COND", {});
  return rows[0]?.userNm || null;
}

/**
 * 로그인 사용자의 소속+직급 정보(ERP 자체 포맷 문자열, 예: "교직원(혁신지원사업단,
 * 산단 사-조교)"). (2026-08-22 실측 완료 — POST /com/UserCtr/findUserGbList.do,
 * 응답 Dataset "DS_USER_GB". currentLoginUser==="1"인 행이 지금 로그인한 프로필.)
 * @returns {Promise<string|null>}
 */
export async function fetchLoginUserGbInfo() {
  const rows = await postDataset(ENDPOINTS.userGbList, "DS_COND", {}, undefined, "DS_USER_GB");
  const current = rows.find((r) => r.currentLoginUser === "1") || rows[0];
  return current?.userGbnNm || null;
}

/**
 * 로그인 계정이 실제로 ERP 메뉴 권한을 가진 menuId 전체 집합.
 * ERP의 메뉴 트리 권한 검사를 그대로 재현하기 위한 함수 — 특정 menuId가
 * 이 집합에 없으면, 그 화면은 이 계정으로 ERP 메뉴를 통해서는 절대
 * 들어갈 수 없는 화면이라는 뜻이다. 학적변동승인처리(M104947)처럼 우리가
 * background.js에서 API를 "직접" 호출하는 화면은, 메뉴를 거치지 않기
 * 때문에 이 검사 없이는 권한이 없어도 조회가 그냥 성공해버린다 — 그래서
 * 이런 화면을 폴링하기 전엔 반드시 이 함수로 먼저 확인해야 한다.
 * (2026-09-05 실측 완료 — 권한 없는 계정과 있는 계정 응답 대조 확인됨)
 * @returns {Promise<Set<string>>}
 */
export async function fetchAuthMenuIds() {
  const rows = await postParamsOnly(ENDPOINTS.authMenuList, {}, "DS_MENULIST");
  return new Set(rows.map((r) => r.menuId).filter(Boolean));
}

/**
 * 학적변동대상자목록. (4단계, kbu-assistant fetchStatusChangeList 이식)
 * 응답 Dataset "DS_SREG260". 필터 없이 세션 컨텍스트로 호출.
 * @returns {Promise<Array<Object>>}
 */
export function fetchStatusChangeList() {
  return postDataset(ENDPOINTS.statusChangeList, "DS_COND", {}, undefined, "DS_SREG260");
}

/**
 * 특정 학생의 학적변동 신청 1건에 대한 승인 단계별 현황(학과조교/지도교수/
 * 학과장/최종승인부서 등). (4단계, kbu-assistant fetchStatusChangeStages 이식)
 * 응답 Dataset "DS_SREG250".
 * ⚠️ kbu 원본은 rowOpts: { rowType: "update", includeOrgRow: true }를 함께
 * 보냈는데, 이 프로젝트의 buildXmlRequest는 그 옵션을 지원하지 않는다. 우선
 * 일반 Row로 보내보고, 빈 응답이 오면 buildXmlRequest에 rowType 지원을
 * 추가해야 할 수 있다(미검증 — 실사용 중 확인 필요).
 * @param {string} stuno
 * @param {string} schregModAplyDt
 * @param {string} schregModGbn
 * @returns {Promise<Array<Object>>}
 */
export function fetchStatusChangeStages(stuno, schregModAplyDt, schregModGbn) {
  return postDataset(
    ENDPOINTS.statusChangeStages,
    "DS_COND",
    { stuno, schregModAplyDt, schregModGbn },
    ["stuno", "schregModAplyDt", "schregModGbn"],
    "DS_SREG250"
  );
}

/**
 * 협조문 상세 (subject/deptNm/ctnt1~ctnt8/ctnt1Tmp~ctnt8Tmp 등 90여개 컬럼).
 * 2026-08-19 실측 완료 — 응답 Dataset id도 목록과 동일하게 "DS_BSNS052". 본문
 * 원문 추출은 extractDetailText()를 통해서 할 것.
 * @param {{aprvNo: string}} params
 */
export function fetchCoopDocDetail({ aprvNo }) {
  return postDataset(ENDPOINTS.detail, "DS_COND", { aprvNo }, undefined, "DS_BSNS052");
}

/**
 * 결재단계(결재현황) 상세. (⚠️ menuId/pgmId 미검증)
 * @param {{aprvNo: string}} params
 */
export function fetchAprvStatusList({ aprvNo }) {
  return postDataset(ENDPOINTS.aprvStatus, "DS_COND", { aprvNo });
}

/**
 * 첨부파일 목록. (2026-08-21 팀원 실측 완료 — 100% 확인됨) aprvNo가 아니라
 * attachNo(첨부그룹 식별자, 목록/상세 응답에 이미 들어있는 필드)만 넘기면 됨.
 * 응답 Dataset id는 "DS_SSTM031". 각 Row가 개별 파일 하나(seq/fileNm 등)에 대응.
 * @param {string} attachNo
 * @returns {Promise<Array<Object>>}
 */
export function fetchAttachments(attachNo) {
  return postParamsOnly(ENDPOINTS.attachList, { attachNo }, "DS_SSTM031");
}

/**
 * 첨부파일 바이너리 다운로드. (2026-08-21 팀원 실측 완료 — 100% 확인됨) 목록/상세
 * 조회와 달리 이 엔드포인트는 Nexacro XML이 아니라 일반 form-urlencoded 요청이고,
 * 응답도 XML이 아니라 파일 바이너리 그대로임.
 * @param {string} attachNo
 * @param {number} [seq]  파일 순번 (fetchAttachments 결과의 row.seq, 기본 1)
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function fetchAttachmentFile(attachNo, seq) {
  const url = `${BASE_URL}${ENDPOINTS.fileDownload.path}`;
  const body = new URLSearchParams({
    attachNo,
    seq: String(seq || 1),
    menuId: ENDPOINTS.fileDownload.menuId,
  }).toString();

  const res = await fetchWithRetry(url, {
    method: "POST",
    credentials: "include",
    referrer: `${BASE_URL}/nx/index.html`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const disposition = res.headers.get("Content-Disposition") || "";
  let filename = "첨부파일";
  const match = disposition.match(/filename\*?="?([^";]+)"?/i);
  if (match) {
    try {
      filename = decodeURIComponent(match[1]);
    } catch (e) {
      filename = match[1];
    }
  }
  const blob = await res.blob();
  return { blob, filename };
}

/**
 * 활동 로그 호출 (세션 연장 안전장치, 선택 사항).
 * 실측 검증 결과 목록 API 호출만으로도 세션 연장이 충분해서 필수는 아님.
 * 실패해도 무시 (안전장치일 뿐 핵심 로직 아님).
 */
export function pingActivityLog() {
  return fetch(`${BASE_URL}${ENDPOINTS.activityLog.path}`, {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}
