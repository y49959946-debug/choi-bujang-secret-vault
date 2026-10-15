# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 단계 기록

### 2단계 · 자료를 코드 밖으로 옮깁니다

- 가상 메모 네 건은 학습용 Supabase `public.notes` 테이블로 옮겼습니다. `owner_id uuid` 칸은 있지만 아직 비어 있고 외래키는 없습니다. RLS를 켰고 anon·authenticated에는 읽기 권한이 없습니다. 테이블을 만든 SQL은 메모 문장이 들어 있어 `*.local.sql`로 Git에서 제외합니다.
- 정적 `data.json`은 더 이상 배포하지 않습니다. 처음에는 메모만 비웠지만(`"notes": []`) 1단계 확인 표시 `SAMPLE_NOTE_1`이 정적 응답에 남아 심판이 `S02_MARKER_IN_STATIC`으로 거부했습니다. 그래서 `data.json`·`public/data.json`을 저장소에서 지우고, `scripts/build-public.mjs`가 빌드 결과에서도 `public/data.json`을 지우게 했습니다. 이제 `/data.json`은 404입니다. 빌드가 만드는 `/aleph.json`은 시작 틀의 배포 확인 파일이라 그대로 둡니다.
- `vercel.json`의 `headers`로 모든 응답에 `X-Content-Type-Options: nosniff`를 붙였습니다.
- 화면은 `/api/notes` 서버 함수(`api/notes.js`)에서 메모를 받아 그립니다. 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`로 DB를 읽습니다. 키는 브라우저 파일·응답·로그에 넣지 않습니다.
- 환경변수 값은 Vercel → 프로젝트 → Settings → Environment Variables에 학생이 직접 넣습니다. 코드·Git·채팅에 적지 않습니다. 값을 넣거나 바꾼 뒤에는 다시 배포해야 반영됩니다.

**남은 약점:** `/api/notes`는 아직 로그인 확인이 없는 공개 주소입니다. 키는 숨겼지만, 주소만 알면 누구나 함수를 불러 가상 메모 네 건을 받아 갈 수 있습니다. 3단계에서 로그인으로 요청자 신원을 확인하고, 4단계에서 `owner_id`로 타인 자료 접근을 막기 전까지 DB에는 가상 메모만 둡니다.

**지워지지 않은 이력:** 최신 파일에서 메모를 지웠어도 첫 커밋과 그 시점의 Vercel 배포에는 가상 메모가 남아 있습니다.

#### 가상 메모 문장 검색 확인 절차

가상 메모 네 건의 본문 문장을 아래 정규식 하나로 한 번에 찾습니다. README 자신이 검색에 걸리지 않도록 본문 문장을 그대로 적지 않고 정규식으로만 적습니다.

```
실습용 가상 (과제|포트폴리오|리추얼|행정) 기록
```

1. **현재 배포 파일:** 로그인하지 않은 시크릿 창에서 `/`(페이지 소스 보기, `Ctrl+U`)와 `/aleph.json`을 열고 `Ctrl+F`로 위 문장을 찾습니다. 0건이어야 합니다. `/data.json`은 404여야 합니다.
2. **GitHub 최신 파일:** 저장소 폴더에서 `git fetch origin` 뒤 다음을 실행합니다. 출력이 없어야 합니다.
   ```
   git grep -nE "실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" origin/main -- .
   ```
3. **옛 공개 이력(남은 노출 확인):** 다음 명령은 메모 문장이 들어갔거나 빠진 커밋을 보여 줍니다. 결과가 있으면 과거 노출이 아직 남아 있다는 뜻입니다.
   ```
   git log --oneline -G"실습용 가상 (과제|포트폴리오|리추얼|행정) 기록" origin/main -- .
   ```
4. **공개 API(남은 약점 확인):** 시크릿 창에서 `/api/notes`를 엽니다. 3단계 전까지는 메모 네 건이 보이는 것이 현재 상태이며, 이것을 보호 완료로 기록하지 않습니다.

#### 검색 결과 기록 (2026-10-06, 커밋 `ea73539` 배포 기준 · 정적 data.json 제거 전)

| 검사 대상 | 결과 |
|---|---|
| 배포 `/data.json` | `"notes": []`, 메모 문장 0건 |
| 배포 `/` 화면 HTML | 메모 문장 0건, 화면은 `/api/notes`에서 메모를 받음 |
| 배포 `/aleph.json` | 열림, 메모 문장 0건 |
| GitHub 최신 `origin/main` 추적 파일 | 메모 문장 0건 |
| 옛 커밋 이력 | `06123c5`(첫 커밋)에 메모 네 건이 `data.json`·`public/data.json`으로 공개된 채 남아 있음. `a5ed7e5`는 그 문장을 지운 커밋 |
| 옛 Vercel 배포 | 첫 커밋으로 만든 배포 기록은 지우지 않았으므로 그 시점의 `/data.json`이 남아 있을 수 있음 |
| 공개 API `/api/notes` | 로그인 없이 가상 메모 네 건 응답 (남은 약점) |

정적 `data.json`을 지운 뒤에는 `/data.json`이 404인지 다시 확인해 이 표에 덧붙입니다. 확인하기 전에는 결과를 적지 않습니다.

**결론:** 현재 배포 파일과 GitHub 최신 파일에서는 메모 문장이 사라졌습니다. 그러나 옛 공개 커밋 `06123c5`와 옛 배포가 남아 있으므로 과거 노출은 해소되지 않았습니다. 또 `/api/notes`가 로그인 없이 열려 있어 현재도 누구나 가상 메모를 읽을 수 있습니다.

### 6단계 · 등록한 기기만 자료실에 들어옵니다

- `src/decider.mjs`에 규칙 `device_registered`를 더했습니다. `RULE_IDS`는 `['starter.deny', 'device_registered']`입니다.
- 판정 요청(`docs/DECIDER_REQUEST.md`)의 `deviceRegistered`가 `true`일 때만 자료실 읽기(GET)를 `allow`(이유 코드 `approved`)로 허용합니다. `false`이거나 값이 없으면 `deny`(이유 코드 `device_not_registered`)입니다. 읽기가 아닌 요청은 시작 틀의 `starter.deny`대로 거부합니다.
- 계약에 있는 `deviceRegistered`·`method`만 읽습니다. `request.device`처럼 계약에 없는 값, 브라우저가 보낸 사용자 번호·역할은 쓰지 않습니다.
- 이번 단계에는 따로 설치할 접속 프로그램이 없습니다. 인증서·CA·서명 키·기기 개인키를 만들거나 Git에 넣지 않았습니다. 배포된 화면과 `/api/*`는 바꾸지 않았습니다.

#### 확인 순서

1. 저장소 루트에서 `npm run decider:test`를 실행합니다.
2. 출력에 다음 두 줄이 모두 보이는지 확인합니다.
   ```
   통과 · 등록 기기의 정상 요청
   통과 · 미등록 기기의 가상 요청
   ```
   `등록 기기의 정상 요청`은 `allow`일 때, `미등록 기기의 가상 요청`은 `deny`이면서 이유 코드가 `device_not_registered`일 때만 `통과`로 나옵니다. `확인 필요`가 하나라도 나오면 `src/decider.mjs`를 다시 봅니다.
3. 시크릿 창에서 배포 주소에 A로 로그인해 기존 메모 화면이 그대로 열리는지 봅니다.

#### 시험 결과 기록 (2026-10-13, 커밋 `30312e8`)

| 시험 요청 | 판정 | 이유 코드 | 규칙 |
|---|---|---|---|
| 등록 기기의 정상 요청 (`GET /notes/:id`, `deviceRegistered: true`) | allow | approved | device_registered |
| 미등록 기기의 가상 요청 (`deviceRegistered: false`) | deny | device_not_registered | device_registered |

`npm run decider:test`는 가상 요청으로 하는 로컬 연습이며 심판 판정이 아닙니다. 미등록 기기에서 들어오는 실제 공격은 심판이 따로 시험합니다.

### 7단계 · 평소와 다른 접속은 다시 확인합니다

- `src/decider.mjs`에 입력 검사 `readAccessContext`와 규칙 `step_up_required`를 더했습니다. `RULE_IDS`는 `['starter.deny', 'device_registered', 'step_up_required']`이며 기기 규칙이 여전히 가장 먼저입니다.
- 접속 정보는 `signals.source`가 `judge_fixture`(엔진이 검증해 넘긴 심판 가상 사건)일 때만 씁니다. `none`이나 그 밖의 출처, 값이 없는 칸은 `null`로 두고 정상값으로 채우지 않습니다.
- 새벽(0~5시) + 처음 보는 네트워크(`unusual`·`new`·`first_seen`) + 최근 10분 사건 10건 이상이 모두 겹칠 때만 `step_up`(이유 코드 `step_up_required`)입니다. 지역은 근거로 쓰지 않으며 지역 하나로 거부·영구 차단하지 않습니다.
- 다시 확인은 계약의 `stepUp`만 봅니다. `verified`가 `true`이고 `authAgeSeconds`가 0~300초일 때만 같은 사건을 허용합니다. 토큰 원문은 판정기·로그·README에 남기지 않습니다.

#### 재로그인 확인 계약 점검 (2026-10-13)

- 요청 계약(`docs/DECIDER_REQUEST.md`)에는 `stepUp: {verified, authAgeSeconds}` 칸이 있습니다. 그러나 이 값을 실제로 채우고 새 로그인 시각을 검증하는 제공 엔진(`student-kit/sdp-core`)은 이 저장소와 작업 환경에 없습니다.
- 그래서 가상 사건 규칙만 시험했습니다. **실제 자료 차단(다시 로그인 전 차단)과 새 로그인 뒤 허용의 실측은 미실행**입니다. 엔진이 준비된 환경에서만 실측합니다.

#### 가상 시험 결과 (커밋 `b17cdd2`)

| 시험 | 결과 |
|---|---|
| `npm run decider:test` | 4항목 통과 (등록 기기 allow, 미등록 deny, 복합 이상 step_up, 다시 확인한 복합 이상 allow) |
| `npm run fixture:7` | 정상 사건 allow, 복합 이상 사건 step_up |
| 복합 이상 + 아직 다시 로그인 안 함 | step_up · step_up_required |
| 복합 이상 + 엔진 확인 60초 전 새 로그인 | allow · approved |
| 복합 이상 + 800초 전 로그인 / 시각 없음 | step_up · step_up_required |
| 실제 재로그인 전 차단·새 요청 허용 | **미실행** (제공 엔진 없음) |

### 8단계 · 자료마다 갈 수 있는 구역을 나눕니다 (통과)

- **구역:** `src/resources.mjs`와 판정기가 프로젝트의 자원을 세 구역으로 나눕니다. 내 메모 `owner_notes`(`note:<id>`), 반 공지 `class_notices`(`notice:<id>`), 강사 자료 `instructor_materials`(`material:<id>`).
- **판정기:** 메모는 한 건 읽기·수정·삭제와 추가만 엽니다. 메모 전체 목록 `GET /notes`는 여러 사람의 자료를 한꺼번에 여는 경로라 `route_not_allowed`로 거부합니다(심판이 처음 짚은 원인). 반 공지·강사 자료는 GET만 허용하고, POST·PUT·PATCH·DELETE는 `notice_write_denied`·`material_write_denied`로 거부합니다. 모르는 경로·쿼리·path와 route 불일치는 거부합니다. 계약에 역할 칸이 없어 모두 일반 학생으로 봅니다.
- **메모 API:** 메모 한 건은 저장된 `owner_id`를 먼저 읽어 검증된 사용자와 대조합니다. 없으면 404, 주인이 다르면 `403 OWNER_MISMATCH`이고 로그에 짧은 사유만 남깁니다. `id` 밖의 쿼리는 400, 본문의 role 등은 403입니다.
- **확인 방법:** `npm run decider:test`(4항목 통과). 배포 주소에서 A로 로그인해 메모 추가·수정·삭제가 되는지, B로 A 메모 주소를 직접 부르면 403인지 봅니다.

### 9단계 · 도플갱어 접속을 탐지하고 회수를 제안합니다

- **입력 정리(`src/detect.mjs`):** 사건에서 시각·가명 사용자(`subjectId` 또는 연습 형식 `identity.sub`)·기기(`deviceId`)·요청 종류(`method`)·판정(`decision`)과, 엔진이 검증한 출처(`signals.source === 'judge_fixture'`)의 네트워크만 읽습니다. 메모 내용·토큰·실명은 읽거나 남기지 않습니다.
- **탐지 규칙 하나:** 평소와 다른 네트워크(`unusual`·`new`·`first_seen`)의 GET이 같은 사용자 기준 어느 10분 구간에서든 120건을 넘을 때만 의심입니다. 지역은 근거로 쓰지 않고, 평소 네트워크의 다량 조회는 정상으로 둡니다. 네트워크 칸이 없는 공식 연습 사건은 `docs/DETECT_EVENTS.md` 계약대로 다량 조회만으로 판단합니다.
- **회수 제안:** 판정기 응답과 별도로 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId }`를 냅니다. 대상은 그 구간에서 조회를 가장 많이 보낸 확인된 기기 한 개이고, 같은 사용자의 정상 기기는 넣지 않습니다. 회수 API를 부르거나 기기 권한을 바꾸지 않으며, 실제 회수와 경과 시간은 엔진·심판이 확인합니다.
- **확인 방법:** `npm run detect:test`(6항목 통과). 가상 시험에서 낯선 네트워크+121건 이상은 대상 기기와 함께 회수 제안, 평소 네트워크 200건·낯선 지역만·조회 30건·10분 밖 분산·정상 기기는 `observe`였습니다. 이 결과는 로컬 연습이며 실제 회수나 심판 판정이 아닙니다.

### 10단계 · 침해 전 사본으로 복구합니다

#### 조건별 동작 요약

| 조건 | 이 저장소의 동작 | 근거 코드 |
|---|---|---|
| 백업 검증 | 복구 전에 사본을 **다시 읽어** 검증하고, 사본이 없거나 검증에 실패하면 **아무것도 쓰지 않고 멈춥니다**. 정책 사본은 고정 지문·파일별 SHA-256·기준 커밋(`195d38a`)으로, 메모 사본은 ID·소유자·제목/내용 SHA-256으로 검증합니다. 메모 복구는 쓰기 직전에 사본을 한 번 더 읽어 처음 검증한 사본과 같을 때만 씁니다. | `src/policy-diff.mjs`, `src/policy-restore.mjs`, `api/restore.js` |
| 실행 전 버전·바뀔 항목 | 정책 되돌리기는 기본이 미리보기입니다. 복원할 사본 버전(기준 커밋·지문), 바뀔 파일·설정 칸, 보존 항목, 계획 지문을 먼저 보여 주고, 그 지문을 넣어야만 실행합니다. 메모 복구 응답에는 사본 버전(`backupVersion`)과 바뀐 칸(`changes`)이 들어갑니다. | `scripts/policy-restore.mjs` |
| 운영 정책 미접촉 | 정책 비교·되돌리기는 작업 폴더의 시험 정책 파일만 다룹니다. Supabase 실제 RLS·Vercel 배포에는 접속하지 않습니다. | `src/policy-restore.mjs` |
| 지정한 한 건만 복원 | 요청 본문의 메모 ID 하나만 받습니다. 사본 ID·소유자·해시와 지금 행의 주인을 대조한 뒤 그 한 건만 고치거나 다시 넣고, 복원 뒤 다시 읽어 ID·소유자·해시를 대조합니다. 같은 소유자의 다른 메모 지문이 복원 전후로 같은지도 확인합니다. | `api/restore.js` |
| 감사 기록 보존 | 감사 기록은 덧붙이기만 합니다(DB 트리거가 수정·삭제 금지). 시작 기록을 못 쓰면 복원하지 않고, 결과 기록을 못 쓰면 방금 쓴 한 건을 복구 전 상태로 되돌리고 멈춥니다. 감사 기록 없는 복원은 남지 않습니다. 복원 전후로 이 메모의 이전 감사 기록이 모두 그대로인지 확인해 응답(`audit`)에 넣습니다. | `api/restore.js`, `supabase/notes-step10-restore.sql` |
| 다른 서비스 규칙 보존 | 정책 되돌리기는 정책 파일 6개와 설정 칸 3개만 다루고, `judgeIssuer`·`step`·다른 서비스 파일은 실행 전후 지문이 같아야 합니다. `allowedRoutes`는 9단계 사본과 같고, 복구 경로는 `restoreRoute`에만 등록합니다. | `src/policy-restore.mjs`, `aleph.config.json` |

#### 배포 실측 요약 (커밋 `d5fdb46` 배포, 2026-10-14 15:18~15:23 KST, 시험 계정 B)

| 확인할 것 | 결과 | 근거 |
|---|---|---|
| 사본을 다시 읽어 검증했는가 | **통과** | 정책 사본: `npm run policy:diff`·`policy:restore` 미리보기에서 manifest 고정 지문, 파일 6개 지문, 설정 칸 지문, 기준 커밋(`195d38a`) 대조 모두 일치, 바뀔 항목 없음. 메모 사본: Supabase `notes_backup` 2건을 다시 읽어 제목·내용 SHA-256을 계산하니 저장된 해시와 2/2 일치 |
| B 메모 변조 뒤 복구 — 사본 일치 | **통과** | `POST /api/restore` 200 `restored: true`. 응답의 ID = 지정한 ID, 소유자 = 사본 소유자, 제목·내용 해시 = 침해 전 해시. `verified` 5칸(id·owner·contentHash·otherNotesUnchanged·auditHistoryPreserved) 모두 true. 감사 기록 `started→restored`(0→2, 이전 기록 보존). 다른 메모 5건 그대로. 응답에 본문 없음. B가 다시 조회하면 200, 해시 같음 |
| B 메모 삭제 뒤 복구 — 사본 일치 | **통과** | 위와 같은 항목 모두 통과. 감사 기록 2→4(앞선 2건 보존) |
| 복구 직후 1~9단계 금지 요청 재전송 | **통과** (10/10 거부) | 공개 data.json 404, 토큰 없는 메모 목록 401, 토큰 없는 메모 조회 401, 위조 토큰 401, 쿼리 owner_id 400, 본문 owner_id 403, 본문 role 403, 토큰 없는 복구 401, 복구 요청에 owner_id 칸 400, GET 복구 405 |
| 복구 직후 정상 사용 | **통과** (3/3) | B 본인 메모 조회 200(해시 같음), 목록 200, 금지 요청 뒤에도 메모 해시 그대로 |
| 배포 실측 (`npm run recovery:recheck -- --live`) | **통과** 70 · 실패 0 | 배포에 data.json 404, 토큰 없는 목록·한 건 401 + 로컬 복구·재시험 67 |

배포 B 계정 시험 합계: **통과 36 · 실패 0** (`scripts/restore-live-check.browser.js`를 B로 로그인한 탭의 개발자 도구 콘솔에서 실행. 토큰·본문은 출력하지 않음).

#### 안전 정책 사본과 되돌리기

- **안전 정책 차이 보기 (`npm run policy:diff`):** 9단계 저장점 커밋(`195d38a`)에서 꺼낸 정책 사본(`recovery/baselines/step9`)을 다시 읽어 검증한 뒤, 작업 폴더의 시험 정책과 차이만 보여 줍니다. 쓰기 0건입니다. 검증은 코드에 고정한 manifest 지문과 파일별 SHA-256으로 하고, Git 기록이 있으면 기준 커밋 내용과도 대조합니다. 어느 하나라도 다르면 멈춥니다.
- **정책 되돌리기 (`npm run policy:restore`):** 기본은 미리보기입니다. `-- --apply --plan <지문>`일 때만 실행하며, 실행 직전에 사본을 다시 읽어 같은 검증을 하고 계획을 다시 만들어 지문이 다르면 하나도 쓰지 않습니다. 사본과 다른 정책 파일과 설정 칸(`allowedRoutes`·`identityProvider`·`originalApiUrl`)만 사본 값으로 되돌립니다. `judgeIssuer`·`step`·다른 서비스 파일은 보존하고, 감사 기록은 `recovery/audit/restore-log.jsonl`에 해시 체인으로 덧붙이기만 합니다. 실행 뒤 감사 기록 앞부분이 그대로인지 확인합니다. `restoreRoute`가 등록된 복구 경로(`POST /api/restore`)면 보존하고, 다른 값이면 덮어쓰지 않고 멈춥니다.
- **현재 상태:** 사본과 다른 곳은 `restoreRoute` 칸의 복구 경로 등록 1곳뿐이고, 미리보기 결과는 `NOTHING_TO_RESTORE`(되돌릴 것 없음)입니다.

#### 메모 한 건 복구 서비스

| 항목 | 내용 |
|---|---|
| 서비스 | `api/restore.js` (Vercel 서버 함수) |
| 경로 | `POST /api/restore` (`aleph.config.json`의 `restoreRoute`에 등록) |
| 요청 | `Authorization: Bearer <로그인 토큰>`, 본문 `{ "id": "<메모 UUID>" }` 하나만(다른 칸·쿼리는 400) |
| 응답 | `{ ok, restored, id, ownerId, titleSha256, contentSha256, restoredNote, backup, backupVersion, changes, backupReread, verified, audit, scope, auditRecorded }`. 맨 위 `id`·`ownerId`·해시는 복구 뒤 DB에서 다시 읽은 행의 값이고, `backup`은 사본의 값이라 응답만으로 둘을 대조할 수 있습니다. 같은 값을 `owner`·`owner_id`·`contentHash`·`content_sha256`·`title_sha256` 이름으로도 넣습니다. 메모 본문은 돌려주지 않습니다. |
| `verified` | `{ id, owner, contentHash, otherNotesUnchanged, auditHistoryPreserved }` — 모두 `true`일 때만 `200 restored: true` |
| `audit` | `{ table: "restore_audit", appendOnly: true, runId, recorded: ["started", "restored"], entriesBefore, entriesAfter, previousEntriesPreserved }` |
| `scope` | `{ restoredNotes: 1, otherNotesChecked, otherNotesUnchanged }` |
| 비공개 사본 | `public.notes_backup` — 메모가 처음 만들어질 때 DB 트리거가 제목·내용과 SHA-256을 한 번만 저장. 이후 수정·삭제는 사본에 반영되지 않음. anon·authenticated 권한 없음 |
| 감사 기록 | `public.restore_audit` — 시작·결과·해시만 덧붙임(DB 트리거가 수정·삭제 금지). 메모 본문·토큰 없음 |

- **멈추는 경우(아무것도 쓰지 않음):** 사본 없음(404), 사본 해시 불일치(409), 지금 행의 주인이 다름(409), 쓰기 직전 다시 읽은 사본이 처음과 다름(409 `BACKUP_UNVERIFIED`), 보존 기준을 읽지 못함(502), 시작 감사 기록을 쓸 수 없음(503).
- **되돌리고 멈추는 경우:** 결과 감사 기록을 한 번 다시 시도해도 쓸 수 없으면, 방금 고친 행은 복구 전 내용으로, 방금 다시 넣은 행은 빼고 `503 AUDIT_UNAVAILABLE`(`restored: false`, `rolledBack`)으로 응답합니다.
- **소유자 키:** `src/owner-key.mjs`(메모 API와 같은 규칙). 학생 토큰은 검증된 sub, 심판 토큰은 sub·runId·identity를 묶은 키입니다. 본문의 `owner_id`·`role`은 받지 않습니다.
- **준비(한 번):** Supabase SQL Editor에서 `supabase/notes-step10-restore.sql`의 ①→②→③을 실행합니다. 사본은 이 SQL을 실행한 뒤 새로 만든 메모부터 생깁니다.
- **확인(시험 계정 B로만):**
  1. B로 로그인해 메모를 하나 만듭니다(사본 생성).
  2. 그 메모를 수정(변조)하거나 삭제합니다.
  3. B의 토큰으로 `POST /api/restore`에 `{ "id": "<그 메모 id>" }`를 보냅니다.
  4. 응답의 `verified`가 모두 `true`, `audit.recorded`가 `["started", "restored"]`이고, B 화면에서 메모 내용이 처음 내용으로 돌아와야 합니다.
  5. A의 토큰으로 같은 요청을 보내면 404이고 아무것도 바뀌지 않아야 합니다.
- **로컬 시험:** `npm run test:restore`(가짜 DB 13개: 변조·삭제 복구, 다른 메모·앞선 감사 기록 보존, 사본 변조·쓰기 직전 사본 변경 시 멈춤, 감사 기록 실패 시 멈춤·되돌림, 소유자 거부), `npm run test:policy`(정책 비교·되돌리기 30개), `npm run owner:check`. 로컬 연습이며 심판 판정이 아닙니다.

#### 복구 뒤 재시험 순서

결과는 네 가지로만 적습니다. **통과**(실행했고 기대 결과 확인), **실패**(실행했지만 기대와 다름), **부분 확인**(일부 조건만 확인), **미실행**(실행하지 않았거나 환경이 없음. 결과를 짐작해 채우지 않음). 앞 단계가 실패하면 다음 단계로 넘어가지 않습니다.

1. **사전 백업 다시 읽기:** `npm run policy:diff`로 정책 사본을 다시 검증합니다. 검증에 실패하면 멈춥니다.
2. **정책 복귀 확인:** 같은 출력에서 사본과 다른 곳이 `restoreRoute` 칸의 복구 경로 등록 하나뿐인지 봅니다. 다른 차이가 있으면 `npm run policy:restore`로 미리보기 → `-- --apply --plan <지문>`으로 되돌린 뒤 1부터 다시 합니다.
3. **복구 뒤 재시험(로컬):** `npm run recovery:recheck`. 실패가 하나라도 있으면 종료 코드 1입니다.
   - API 핸들러 시험: 실제 `api/notes.js`·`api/restore.js` 코드를 가짜 DB와 이 실행에서만 만든 가짜 서명 키로 호출합니다. 실제 Vercel·Supabase에는 요청하지 않습니다.
   - 판정기·탐지기 가상 입력 시험: 계약 모양의 가상 요청을 `decide()`에, 가상 사건을 `detect()`에 넣습니다. 실제 기기 확인이나 회수가 아닙니다.
   - 0: 정책 사본과 가짜 DB 메모 사본을 다시 읽어 검증합니다.
   - 1: 현재 정책이 사본과 같은지, 공개 `data.json`과 브라우저 파일 속 서버 키가 없는지 봅니다.
   - 2: 시험 계정 B의 메모 하나를 **변조**, 다른 하나를 **삭제**한 뒤 각각 `POST /api/restore`로 복구합니다. 그 한 건의 ID·소유자·해시가 사본과 같고 다른 메모는 그대로인지 봅니다. 사본을 변조하면 409로 거부하고 메모를 바꾸지 않는지도 봅니다.
   - 3: **복구 직후** 1~9단계 대표 금지 요청을 다시 보냅니다. API로 토큰 없음·서명 위조·다른 발급자·다른 대상·만료(3단계), A의 B 메모 조회·수정·삭제·복구(4단계), 쿼리·본문의 owner_id·role(4·8단계). 가상 입력으로 미등록 기기 등(6단계), 복합 이상 접속(7단계), 메모 전체 목록·기능 경로·PATCH·알 수 없는 경로·공지 수정·강사 자료 삭제(8단계), 낯선 네트워크 다량 조회(9단계). 모두 다시 거부되고 자료가 바뀌지 않아야 합니다.
   - 4: 정상 요청을 다시 보냅니다(B의 복구 메모 조회, A 본인 메모 조회·수정·추가·삭제, 등록 기기 읽기·공지 읽기 등).
4. **배포 실측(선택):** `npm run recovery:recheck -- --live`. 배포 주소에 토큰 없는 GET 세 개만 보내 `/data.json` 404, `/api/notes`와 메모 한 건 401을 봅니다.
5. **실제 서비스(직접):** B 계정으로 위 "확인" 1~5를 배포에서 합니다. `scripts/restore-live-check.browser.js`를 B로 로그인한 탭의 개발자 도구 콘솔에 붙여 넣으면 변조·삭제 뒤 복구와 복구 직후 금지·정상 요청을 한 번에 보내고 결과표만 출력합니다. 이어서 Supabase SQL Editor에서 `notes-step10-restore.sql` ③(사본·감사 테이블 권한과 트리거)과 `notes-step5-revoke.sql` ①(브라우저 역할 권한 없음)을 다시 실행해 결과를 따로 적습니다.

#### 복구 뒤 재시험 결과 (2026-10-14, 커밋 `d5fdb46`)

| 묶음 | 결과 |
|---|---|
| 정책 사본 다시 읽기 (`policy:diff`·`policy:restore` 미리보기) | **통과**. 지문·파일별 SHA-256·기준 커밋 대조 일치, 사본과 다른 곳은 `restoreRoute` 1곳, 바뀔 항목 없음 |
| 실제 Supabase 메모 사본 다시 읽기 | **통과** (SQL Editor, 15:19 KST). `notes_backup` 2건 모두 다시 계산한 해시가 저장된 해시와 일치. 본문은 조회하지 않음 |
| 로컬 `recovery:recheck` | **통과** 67 · 부분 확인 0 · 실패 0. 사전 백업 검증 4, 정책 복귀 3, B 메모 변조·삭제 복구 13, 복구 직후 금지 요청 36(API 21, 판정기·탐지기 가상 입력 15), 정상 요청 11 |
| 로컬 `test:restore`·`test:policy` | **통과** 13 · 30, 실패 0 |
| 배포 실측 `recovery:recheck -- --live` | **통과** 70 · 실패 0 (15:18 KST). 배포 data.json 404, 토큰 없는 목록·한 건 401 |
| 배포에서 B 메모 변조 뒤 복구 | **통과** (15:23 KST). 위 "배포 실측 요약" 참고 |
| 배포에서 B 메모 삭제 뒤 복구 | **통과** (15:23 KST) |
| 배포에서 복구 직후 금지 요청 재전송 | **통과** 10/10 거부 (15:23 KST) |
| 배포에서 복구 직후 정상 요청 | **통과** 3/3 (15:23 KST) |
| 배포에서 주인이 아닌 계정의 복구 요청 | **거부 확인** (10:39 KST, 이전 커밋). `404 BACKUP_NOT_FOUND`, 감사 기록 `rejected`(`no_backup_for_owner`) |
| 5단계 브라우저 키로 직접 DB 호출 거부 | **미실행** (이번 복구 뒤 다시 확인하지 않음) |
| 6단계 실제 기기 등록, 7단계 실제 재로그인, 9단계 실제 기기 회수 | **미실행** (판정기·탐지기에 가상 입력만 넣었음. 실제 동작은 엔진이 확인) |

### 11단계 · 나만의 접속 앱을 완성합니다 (통과, 커밋 `07ee148`)

#### 제작 1 · 설치형 웹앱 설정과 기기 승인 상태 표시

- **앱 설정:** `public/manifest.webmanifest` — 이름 「BYTE BACK 내 자료실」, 짧은 이름 「내 자료실」, 시작 주소 `/`, 설치 화면(`standalone`), 아이콘 3개(`public/icons/`, 192·512·maskable 512). 설명에 "설치해도 기기 확인이 끝난 것은 아님"을 적었습니다.
- **오프라인 안내:** `public/offline.html`과 서비스 워커 `public/sw.js`. 서비스 워커는 안내 화면·아이콘·manifest만 저장합니다. `/api/*` 요청과 쓰기 요청은 가로채지 않고, 메모 자료·로그인 정보는 저장하지 않으며, 화면은 항상 서버에서 받고 연결이 끊겼을 때만 안내를 보여 줍니다. 따로 설치하는 접속 프로그램은 없습니다.
- **화면(`public/index.html`):** manifest 연결, 「이 기기」 칸에 앱 설치 여부와 기기 승인 상태를 따로 표시합니다. 설치 여부는 표시용일 뿐 신뢰 근거로 쓰지 않고, 기기 승인은 서버 결과가 오기 전까지 "확인되지 않음"입니다. 기기 키·승인 정보는 브라우저 저장소에 넣지 않습니다. 오프라인이면 자료를 보여 주지 않는다는 안내가 뜹니다.
- **기존 보호 유지:** 메모·로그인·복구 API와 판정기는 바꾸지 않았습니다. `vercel.json`에는 `sw.js`·manifest가 항상 새로 받아지도록 캐시 금지 헤더만 더했고, `aleph.config.json`의 `step`을 11로 올렸습니다.
- **로컬 시험:** `npm run test:app` 5개 통과(manifest 항목·아이콘 크기, 화면 문구, 브라우저 저장소에 새 값 없음, 서비스 워커를 가짜 브라우저 환경에서 실행해 `/api` 미가로채기·저장 범위·오프라인 안내 확인). 기존 `test:restore` 13, `test:policy` 30, `recovery:recheck` 67(실패 0), `owner:check`·`decider:test`·`detect:test` 통과. `test:package`의 1개 실패(시작 틀 함수 기준표에 3단계 이후 추가한 API 파일이 없음)는 10단계 커밋에서도 같았던 기존 실패입니다.
- **미실행:** 배포에서 설치(홈 화면 추가)·오프라인 안내 확인

#### 제작 2 · 기기 승인 흐름과 요청 서명

| 구성 | 파일 | 하는 일 |
|---|---|---|
| 기기 승인 API | `api/device.js` | 패스키 등록 → 항상 **승인 대기(pending)**. 패스키 확인 → 서버 DB에서 그 기기가 `approved`일 때만 임시 서명 키를 기기 세션(8시간)으로 등록. 패스키 인증 장치(Windows Hello 등)가 없는 기기는 **메모리 전용 기기 키**로 같은 흐름(`key-challenge`·`key-register`·`key-session`: 서버 문제에 기기 키로 서명해 키 보유 증명 → pending → 승인 뒤에만 세션). 이 API에는 기기를 승인으로 바꾸는 코드가 없음 |
| 요청 서명 검사 | `middleware.js`, `src/device-gate.mjs` | Vercel 라우팅 미들웨어가 `/api/notes`·`/api/restore` **앞에서** 검사. 로그인 토큰이 있는 요청은 승인된 기기 세션의 서명이 있어야 함수까지 감 |
| 서명 규칙 | `src/device-proof.mjs` | `aleph-device-v1 · 메서드 · 경로 · 쿼리 · 본문 SHA-256 · 시각 · 일회용 번호 · 세션 ID`에 ECDSA P-256 서명. 화면도 같은 규칙 |
| 화면 | `public/index.html` | 「이 기기 승인 요청」(패스키 등록, 권한 없음), 「이 기기로 자료실 열기」(패스키 확인). 서버가 `approved`와 세션을 준 뒤에만 자료실을 엶 |
| DB | `supabase/notes-step11-devices.sql` | 기기·문제·세션·일회용 번호 테이블. 브라우저 역할 권한 없음. 서버 전용 키는 기기 `status`·`approved_at`을 고칠 권한이 없음 |

- **승인은 서버에서만:** 승인 요청 버튼은 승인 대기만 만듭니다. 주인이 Supabase SQL Editor에서 `notes-step11-devices.sql` ④를 실행해야 승인됩니다. 서버 전용 키에는 상태 칸을 고칠 권한이 없어 API가 잘못돼도 스스로 승인할 수 없습니다.
- **기기 키 방식 자동 선택:** 화면이 `isUserVerifyingPlatformAuthenticatorAvailable()`로 패스키 인증 장치가 있는지 보고, 있으면 패스키, 없으면 메모리 전용 기기 키를 씁니다(「이 기기」 칸의 「기기 키」 줄에 표시). 메모리 전용 키는 내보낼 수 없게 만들어 화면 변수에만 두므로, 새로고침하거나 앱을 다시 열면 사라져 다시 승인받아야 합니다(키를 저장소에 두지 않는 대가). 승인 대기 문구에 기기 번호 앞자리를 보여 줘, SQL로 승인할 줄을 고를 수 있습니다.
- **기기 키·토큰은 브라우저 저장소 밖:** 로그인 토큰은 화면 메모리에만 있습니다. 기기 키는 운영체제 패스키 저장소(또는 메모리 전용 키)에 있습니다. 서버는 공개키만 저장합니다. 요청 서명용 임시 키는 내보낼 수 없게(`extractable: false`) 만든 화면 메모리 변수에만 있고, 서버는 그 공개키만 받습니다. 패스키 확인 문제(challenge)에 임시 공개키 지문을 넣어, 패스키 서명이 곧 "이 기기가 이 임시 키를 보증함"이 됩니다. 새로고침하면 임시 키가 사라져 다시 패스키로 확인합니다.
- **승인 전에는 자료 없음:** 화면은 승인 전에 `/api/notes`를 부르지 않습니다. 서버도 서명 없는 토큰 요청을 함수까지 보내지 않습니다(403).
- **거부 코드(모두 403, 자료 없음):**

  | 요청 | 결과 |
  |---|---|
  | 로그인 토큰은 있고 기기 서명 없음 (괴물: 설치형 앱 서명 없이 보호 요청) | `DEVICE_PROOF_REQUIRED` |
  | 서명한 뒤 경로·메모 ID·쿼리·메서드 변경 (괴물: 서명 뒤 요청 경로 변경) | `DEVICE_SIGNATURE_INVALID` |
  | 서명한 뒤 수정 본문·복구 대상 변경 (괴물: 서명 뒤 수정 본문 변경) | `DEVICE_SIGNATURE_INVALID` |
  | 같은 서명 요청 재전송 / 시각 2분 초과 | `DEVICE_PROOF_REPLAYED` / `DEVICE_PROOF_EXPIRED` |
  | 승인 대기·회수된 기기, 만료·남의 기기 세션 | `DEVICE_NOT_APPROVED` |
  | 승인 세션 ID를 알아도 다른 키로 서명 | `DEVICE_SIGNATURE_INVALID` |
- **기존 결과 유지:** 로그인 토큰이 없거나 검증되지 않는 요청은 전처럼 함수가 `401`로 거부합니다(앞단은 그대로 통과시킴). 승인된 기기의 서명 요청은 전과 같은 메모·복구 함수가 처리해 주인 확인(403)·쿼리 거부(400) 등 1~10단계 결과가 그대로입니다. `api/notes.js`·`api/restore.js`·판정기는 바꾸지 않았고, `policy:diff`의 차이는 여전히 `restoreRoute` 1곳입니다.
- **바뀐 기대값:** 기기 서명 없이 로그인 토큰만 보내는 요청은 이제 `403 DEVICE_PROOF_REQUIRED`입니다. 10단계의 `scripts/restore-live-check.browser.js`는 기기 서명을 하지 않으므로 이 단계부터 보호 요청이 403으로 나오는 것이 정상입니다.

#### 심판 결과와 수정 · 「기기 키 저장」(S11_KEY_EXPOSED, 커밋 `00b8405`, 50점)

- **확인한 것:** 화면 코드가 로그인 응답 전체(`access_token`·`refresh_token`)를 `localStorage`에 저장하고 있었습니다(5단계부터). 이번 단계 규칙("기기 키나 토큰은 브라우저 저장소에 넣지 않습니다")과 어긋납니다. 저장소 전체에서 키 모양 값(JWK 비밀값, PEM, JWT, 서버 키)은 없었고, 화면 코드에는 WebCrypto 서명 키 손잡이 이름 `privateKey`만 있었습니다.
- **수정:** 로그인 토큰도 화면 메모리 변수에만 둡니다(`saveSession`은 변수만 바꿈). 브라우저 저장소에 쓰거나 읽는 코드가 없고, 10단계까지 저장소에 남은 로그인 정보는 화면을 열 때 지우기만 합니다. 새로고침하면 다시 로그인합니다. 서명 키는 `signer`(내보낼 수 없는 CryptoKey 손잡이)로만 다룹니다. 콘솔 확인 스크립트도 토큰을 저장소에서 읽지 않고, 시험 계정으로 직접 로그인해 그 탭 메모리에만 둡니다.
- **로컬 확인:** 실제 기기 API·검사 코드를 가짜 DB에 붙인 로컬 서버와 헤드리스 브라우저로 로그인 → 승인 요청 → 승인 → 메모 추가까지 한 뒤 로컬 저장소·세션 저장소·IndexedDB·쿠키가 모두 0개, 예전 저장분 삭제, 새로고침하면 로그인·자료 모두 닫힘. 확인 스크립트 1차 6/6, 2차 17/17.

**설정·확인 순서(한 번)**

1. Supabase SQL Editor에서 `supabase/notes-step11-devices.sql`의 ①→②→③을 실행합니다. ③(a)에 브라우저 역할이 없고, ③(c)에 `counter`·`last_used_at`·`used_at`만 나와야 합니다.
2. 배포가 끝나면 배포 주소(공개 주소)에 로그인합니다(새로고침하면 다시 로그인). 자료 목록 자리에 "서버가 이 기기를 승인한 뒤에만 자료를 보여 줍니다"가 나오고 메모가 보이지 않아야 합니다(**승인 전에는 자료 없음**).
3. 「이 기기 승인 요청」을 누릅니다(패스키 기기는 Windows Hello 확인, 패스키가 없는 기기는 메모리 전용 키로 바로 진행). 상태가 "승인 대기 (기기 번호 앞자리 ……)"가 됩니다. 이때 「이 기기로 자료실 열기」를 눌러도 "승인 대기"이고 자료는 열리지 않아야 합니다.
4. SQL Editor에서 ③(b)로 그 앞자리의 `pending` 줄 `id`를 확인하고, ④의 `update … set status = 'approved' …`에 그 id를 넣어 실행합니다. 메모리 전용 키 기기는 **화면을 새로고침하지 않은 채로** 다음 단계로 갑니다.
5. 화면에서 「이 기기로 자료실 열기」 → "승인됨"이 되고 기존 메모 화면(조회·추가·수정·삭제)이 그대로 열려야 합니다(**승인한 기기에서 기존 화면이 열림**).
6. 회수 확인(선택): ④의 회수 SQL을 실행하면 다음 요청부터 "기기 확인이 필요합니다"로 자료가 닫혀야 합니다.
7. **경우의 수 배포 확인:** 배포 주소 탭의 개발자 도구 콘솔에(처음 실행 때 시험 계정 이메일·비밀번호를 물음) `scripts/device-live-check.browser.js`를 붙여 넣어 1차(승인 전) 실행 → 출력된 앞자리의 기기를 SQL로 승인 → 같은 탭에서 2차 실행. 1차는 승인 전 거부 6항목, 2차는 승인 뒤 정상 요청과 괴물 경우의 수(서명 없음, 서명 뒤 메모 ID·쿼리·메서드·경로 변경, 서명 뒤 수정 본문·복구 대상 변경, 재전송, 시각 초과, 토큰 없음) 17항목을 확인합니다. 끝나면 출력된 회수 SQL로 시험용 기기를 회수합니다.

- **로컬 시험:** `npm run test:device` 16개 통과(메모리 전용 키 흐름 2개 포함)(실제 WebCrypto 키로 서명. 서명 없음·경로 변경·본문 변경·재전송·만료·승인 대기·회수·남의 세션·다른 키 거부, 승인 요청은 항상 pending, 승인 전 세션 없음, 비밀값 든 키·바꿔치기 거부, 끝까지 흐름). 헤드리스 브라우저로 화면을 띄워 승인 전 `/api/notes` 요청 0건·승인 대기 시 0건, 승인 뒤 1건이고 화면이 만든 서명이 서버 검증 코드로 통과(경로를 바꾸면 실패), localStorage에는 기존 로그인 키만 있음을 확인했습니다. 서버 응답은 가짜, 패스키는 대역입니다. 기존 `test:app` 5, `test:restore` 13, `test:policy` 30, `recovery:recheck` 67(실패 0), `owner:check`·`decider:test`·`detect:test` 통과.
- **로컬 끝까지 시험:** 실제 `api/device.js`·`src/device-gate.mjs`를 가짜 DB에 붙인 로컬 서버와 헤드리스 브라우저(패스키 장치 없음 → 메모리 전용 키)로 확인했습니다. 로그인 직후 `/api/notes` 요청 0건 → 승인 요청 뒤 pending → 승인 전 열기도 0건 → 승인(SQL 대역) 뒤 "승인됨"·기존 메모 화면 열림·메모 추가 → localStorage에는 기존 로그인 키만 → 새로고침하면 다시 닫힘. 같은 서버에 `device-live-check.browser.js`를 돌려 1차 6/6, 2차 17/17 통과.
- **판정기 형식 확인:** 계약 모양의 가상 요청 3,000건과 형식이 깨진 요청 6건을 `decide()`에 넣어 모두 응답 5칸·이유 코드 형식·`RULE_IDS` 안의 규칙 이름을 확인했습니다(어긋남 0). `src/decider.mjs`는 9단계 사본과 같습니다.
- **배포 확인(이 PC):** 배포 커밋의 `aleph.json` step 11, `/api/device` 비로그인 401, `/api/notes` 토큰 없음·검증 안 되는 토큰 401. 이 PC는 `isUserVerifyingPlatformAuthenticatorAvailable()`가 false라 패스키 인증 장치가 없어 메모리 전용 키 방식을 씁니다.
- **미실행:** 배포에서 위 설정·확인 순서 1~7, 실제 패스키(Windows Hello) 등록·확인


### 12단계 · 총공세와 탈환 작전실

#### 12단계 배포 실측 요약 (커밋 `de685c9` 배포, 2026-10-15 10:10~10:12 KST 서버 시각, 시험 계정 A·B)

| 항목 | 결과 |
|---|---|
| 배포 API 실측(이 표의 요청 수, 41종 공격 목록과 무관) | **41/41줄 실행 · 통과 41 · 실패 0 · 미실행 0** |
| 정상 요청 허용 | **12/12 통과** |
| 금지 요청 거부 | **27/27 통과** |
| 남의 메모(시험 계정 B의 실측용 메모) | 조회·수정·삭제 `403 OWNER_MISMATCH`, 복구 `404 BACKUP_NOT_FOUND` — 통과 |
| 괴물 ① 무인증 → 남의 메모 | 토큰 없음 `401 LOGIN_REQUIRED` → 곧바로 본인 토큰·서명으로 남의 메모 `403 OWNER_MISMATCH` — 통과 |
| 괴물 ② 미등록 → 회수된 기기 | 서명 없음 `403 DEVICE_PROOF_REQUIRED` → 회수된 시험용 기기 서명 `403 DEVICE_NOT_APPROVED`, 회수 기기는 세션도 못 받음(key-session 200 · status revoked · 세션 없음) — 통과 |
| 괴물 ③ 복구 뒤 서명 없는 변경·구역 밖 조회 | 복구 200(verified 모두 true) → 서명 없는 수정 `403 DEVICE_PROOF_REQUIRED` → 구역 밖 `/api/notices` 404(참고, 경로 없음이라 구역 규칙 증거 아님) → 복구 내용 조회 200 — 통과 |
| 집계 제외(통과로 세지 않음) | SQL 확인 1(5단계), 참고 2(없는 경로 404), 실행 불가 3(7·9단계, **41종 목록 미제공**) |
| 증거 | `evidence/step12-live-2026-10-15-full.json`(화면이 만든 결과와 SHA-256 일치 확인: `defc53ee…3ad3ad`). 요청 ID는 Vercel 로그에서 검색해 대조 가능(보존 기간 제한) |
| 이전 실행 | 같은 날 09:59~10:01 KST, 시험 계정 A만(남의 메모 없음): 35/41줄 실행 · 통과 35 · 실패 0 · 미실행 6 → `evidence/step12-live-2026-10-15.json` |


#### 제작 1 · 탈환 작전실(판정기 규칙·탐지 사건·회수 상태·복구 버전 요약)

| 항목 | 화면에 보이는 값 | 출처(화면 표시) | 근거 코드 |
|---|---|---|---|
| 판정기 규칙 | `RULE_IDS` 규칙 수와 이름, 6~8단계 가상 요청 9건의 기대·실제 판정 일치 수 | 서버 실행: 배포 함수가 요청마다 `decide()`를 실제로 실행 | `api/ops.js`, `src/decider.mjs`(변경 없음) |
| 탐지 사건 | 9단계 가상 사건 6건의 기대 일치 수 | 서버 실행 | `src/detect.mjs`(변경 없음), `scripts/detect-test.mjs` |
| 탐지 사건(운영) | 결과 없음 | **미실행**: 운영 반 엔진의 실제 사건을 받는 경로가 없음 | — |
| 회수 상태 | 내 기기 전체·승인 대기·승인·회수 수, 유효한 기기 세션 수 | 실제 기록(DB `device_credentials`·`device_sessions`) | `api/ops.js` |
| 탐지 → 회수 집행 | 결과 없음 | **미실행**: 회수 제안을 실제 회수로 바꾸는 집행은 운영 엔진 몫 | — |
| 복구 버전 | 정책 사본 `step9-195d38a`, 메모 사본 해시 일치/전체, 복구 감사 기록 수·실행 수·결과별 수·마지막 시각 | 배포 고정 값(정책 사본), 실제 기록(DB `notes_backup`·`restore_audit`) | `api/ops.js` |
| 정책 사본 파일 대조 | 결과 없음 | **미실행**(배포 함수에는 사본 파일이 없음). 저장소에서 `npm run policy:diff`로 확인 | `src/policy-diff.mjs` |
| 수치와 기록 대조 | 기기·복구 감사·메모 사본·판정기 각각 일치/불일치 | 서버가 같은 응답의 가린 기록에서 다시 세어 비교 | `api/ops.js` `consistency` |

- **경로:** `GET /api/ops`. 로그인과 **승인 기기 서명**이 있어야 합니다(`middleware.js` matcher에 추가). 토큰이 없으면 401, 서명이 없으면 403 `DEVICE_PROOF_REQUIRED`, 쿼리가 있으면 400, GET이 아니면 405입니다. `allowedRoutes`는 9단계 사본 그대로 두었습니다.
- **요청자 본인 기록만:** 모든 집계는 로그인 토큰으로 정한 소유자 키로만 거릅니다. 다른 사람의 기기·감사·사본은 세지 않습니다.
- **가림:** 메모 본문·제목·토큰·키·패스키 자격 ID·전체 ID를 돌려주지 않습니다. ID는 앞 8자리만 보이고, 메모 사본은 해시 일치 여부만 셉니다(본문은 서버 안에서 해시 비교 뒤 버림).
- **성공 문구를 근거로 쓰지 않음:** 화면은 응답 값을 그대로 옮기기만 합니다(`textContent`만 사용). 각 칸 옆에 출처 표시(실제 기록·서버 실행·배포 고정 값·미실행)가 붙습니다. 「가린 서버 기록 보기」를 펼치면 같은 응답의 기기·복구 감사·메모 사본·판정기 요청 표가 나와 화면 수치와 줄 수를 대조할 수 있습니다.
- **승인 전에는 열리지 않음:** 작전실은 기기 승인 뒤에만 보이고 요청도 그때만 보냅니다. 로그아웃하거나 기기 확인이 풀리면 숨깁니다.

**화면 수치 = 가린 서버 기록 확인 방법**

1. 승인된 기기로 자료실을 열면 「탈환 작전실」이 나옵니다. 위쪽의 「내 소유자 키 앞자리」(8자리)를 확인합니다.
2. 「가린 서버 기록 보기」를 펼쳐 각 표의 줄 수가 카드 수치와 같은지 봅니다(서버 대조 결과는 「수치와 기록 대조」 카드).
3. Supabase SQL Editor에서 `supabase/ops-crosscheck.sql`의 ①~④를 하나씩 실행합니다(`<앞자리>` 자리에 그 8자리). 결과 숫자가 화면 카드 수치와 같아야 합니다.

- **로컬 시험:** `npm run test:ops` 8개 통과. 401·405·400, 본인 기록만 집계, 수치와 가린 기록 일치(해시가 틀린 사본은 일치로 세지 않음), 본문·제목·전체 ID·토큰 미노출, 출처 구분, 판정기 9/9·탐지 6/6, 다른 계정 기록 분리, 작전실 API도 서명 없으면 403, 화면은 승인 뒤에만 열고 `innerHTML`을 쓰지 않음을 확인했습니다.
- **로컬 끝까지 시험:** 실제 `api/ops.js`·`api/device.js`·`src/device-gate.mjs`를 가짜 DB에 붙인 로컬 서버와 헤드리스 브라우저로 로그인 → 승인 → 작전실을 열었습니다. 승인 전 `/api/ops` 요청 0건, 승인 뒤 1건. 카드 수치(기기 1, 감사 2, 사본 1/1, 판정기 9/9, 탐지 6/6)가 가린 기록 표 줄 수와 같고, 사본의 제목·본문이 화면에 나오지 않았습니다.
- **미실행(작성 당시):** 배포에서 작전실 열기와 `ops-crosscheck.sql` 대조 → 아래 「제작 1 배포 확인」에서 진행함
- **제작 1 배포 확인(2026-10-15, 커밋 `82994c1` 배포):** 11단계 기기 테이블이 실제 DB에 없어 `/api/device`가 `502 DEVICE_DB_FAILED`였던 것을 `to_regclass` 쿼리로 확인하고, `notes-step11-devices.sql` ②를 실행해 만들었습니다. 메모리 전용 키 기기(앞자리 `aff3f196`)를 09:28 KST에 SQL로 승인한 뒤 작전실을 열었습니다. 작전실 수치와 `ops-crosscheck.sql`의 집계가 일치함을 사용자가 확인했습니다(④ 메모 사본: 이 계정 `0 / 0`, 쿼리 성공 기준). ①~③의 숫자 자체는 이 README에 옮겨 적지 않았습니다.

#### 제작 2 · 1~11단계 실측표(정상·금지 요청, 기대 결과, 실제 API 결과, 요청 ID, 확인 시각)

| 칸 | 내용 | 어디서 오는 값인가 |
|---|---|---|
| 단계·구분 | 1·2~11단계, 12단계 괴물 ①②③ / 정상·금지·준비·참고 | `public/live-catalog.js`(요청 목록) |
| 요청 | 메서드·경로 모양·인증(없음/본인/위조)·서명(있음/없음/변조) | 자리 표시(`{내 시험 메모}`·`{남의 메모}`)만, 실제 ID 없음 |
| 기대 | 상태 코드 + 오류 코드(예: `403 OWNER_MISMATCH`) + 추가 조건 | 각 API 코드에서 확인한 값 |
| 실제 | 받은 상태 코드 + 응답의 오류 코드(허용 모양만) + 조건 맞음/다름 | **배포 API의 실제 HTTP 응답** |
| 요청 ID | 응답 머리글 `x-vercel-id` | Vercel이 붙인 값(Vercel 로그에서 검색해 대조) |
| 서버 시각 | 응답 머리글 `Date` | 배포 서버 시각 |
| 판정 | 통과(기대=실제) / 실패 / 미실행 | `verdictOf()` — 상태·오류 코드·조건이 모두 같아야 통과 |

- **실행 위치:** 기기 승인 뒤 열리는 「탈환 작전실」 아래 「1~11단계 실측표」. 이 화면의 승인 기기 서명 기능을 그대로 쓰므로 따로 설치하거나 콘솔에 붙여 넣을 것이 없습니다.
- **집계 규칙:** 배포 API에 실제로 보낸 줄(`api`)만 통과·실패를 셉니다. 아래는 따로 표시하고 **통과로 세지 않습니다.**
  - 5단계 브라우저 키 직접 호출 → `SQL 확인`(notes-step5-revoke.sql ①, HTTP 아님)
  - 없는 경로 `/api/notices`의 404 → `참고`. 이 앱에는 공지·강사 자료 API가 없고, `api/notes.js`는 구역 판단 경로를 스스로 `/api/notes…`로 계산해 `ZONE_NOT_ALLOWED`에 HTTP로 도달할 수 없습니다. 그래서 404는 구역 규칙의 증거가 아닙니다.
  - 7단계 재확인·9단계 실제 탐지·회수 → `실행 불가`(운영 엔진 몫)
  - **41종 공격 → `실행 불가`.** 공식 목록을 받지 못해 대응 여부를 확인할 수 없습니다. 이 표의 줄 수(41)는 우리 요청 수일 뿐 41종 목록과 무관합니다.
- **변조·재전송 시험:** 서명을 먼저 만든 뒤 **그 머리글을 그대로** 쓰고 메모 ID·메서드·경로(`/api/notes`→`/api/restore`, 둘 다 보호 경로)·본문만 바꿔 보냅니다. 재전송은 같은 머리글을 두 번 보냅니다. 만료는 5분 전 시각으로 서명합니다.
- **시험 자료:** 실행 중 만든 **시험 메모**만 쓰고 마지막에 지웁니다. 회수 시험은 이 화면의 기기가 아니라 실행이 따로 만든 **시험용 기기(메모리 전용 키)**로 합니다. 복구 감사 기록(`restore_audit`)은 덧붙이기만 하므로 시험 흔적(started·restored·rejected)이 남습니다.

**배포에서 실행하는 순서**

0. 준비: Vercel Deployment Protection이 꺼져 있는지, `select to_regclass('public.device_credentials')` 등이 NULL이 아닌지 확인합니다.
1. (남의 메모 준비) 시크릿 창에서 **시험 계정 B**로 로그인 → 기기 승인 요청 → SQL 승인 → 「이 기기로 자료실 열기」 → 작전실의 「실측용 메모 만들기」 → 나온 ID를 복사합니다.
2. 일반 창에서 **시험 계정 A**로 로그인 → 기기 승인 → 작전실의 「남의 메모 ID」에 붙여 넣고 **「1차 실행」**. (ID를 비우면 남의 메모 관련 줄은 미실행으로 남습니다.)
3. 화면에 나온 SQL(시험용 기기 승인, `returning`으로 1줄 확인)을 SQL Editor에서 실행 → **「2차 실행」**.
4. 화면에 나온 회수 SQL을 실행 → **「3차 실행」**(괴물 ② 회수된 기기 거부, 시험 메모 정리).
5. **「JSON 내려받기」** → 저장소 `evidence/step12-live-<날짜>.json`으로 커밋하고, 요약과 표를 아래 「배포 실측표」에 옮깁니다.
6. (대조) Vercel → Logs에서 표의 요청 ID 몇 개를 검색해 같은 시각·경로·상태 코드인지 확인합니다. Vercel 로그는 영구 보존이 아니라서 JSON 파일이 원본 기록입니다.

- **로컬 끝까지 시험:** 실제 `api/notes.js`·`api/restore.js`·`api/device.js`·`api/ops.js`·`src/device-gate.mjs`를 가짜 Supabase(메모리 표, 메모 생성 시 사본 트리거 흉내, 감사 기록 덧붙이기만)와 이 실행에서 만든 가짜 서명 키에 붙인 로컬 서버를 띄웠습니다. 헤드리스 브라우저 두 창(A·B)으로 위 1~5를 했습니다. **API 41줄 실행 · 통과 41 · 실패 0**(정상 허용 12/12, 금지 거부 27/27), 집계 제외 SQL 1·참고 2·실행 불가 3. 내려받은 파일에는 전체 ID·토큰·본문이 없었고, 화면 저장소 항목은 0개였습니다. 남의 메모 ID를 비우면 관련 11줄이 미실행으로 남는 것도 확인했습니다. 로컬 서버의 요청 ID는 `local::n`이며 배포 결과가 아닙니다.
- **로컬 시험:** `npm run test:live` 9개(목록 무결성, 단계·괴물 포함, 집계 제외 규칙, 판정, 응답 값 추출, 집계, 모든 줄의 실행 코드, 변조·재전송이 원래 서명 재사용, 기록·파일에 토큰·본문·전체 ID 없음).

#### 배포 실측표 (2026-10-15, 커밋 `de685c9` 배포, 시험 계정 A, 남의 메모 = 시험 계정 B의 실측용 메모)

- 실행: Claude 앱 내장 브라우저. 시험 계정 B로 로그인(사용자) → 기기 `0a32492e` 승인(SQL, 사용자) → 「실측용 메모 만들기」. 새 탭에서 시험 계정 A로 로그인(사용자) → 기기 `debd56ca` 승인(SQL) → B 메모 ID를 넣고 1차 → 시험용 기기 `de8cdd9a` 승인(SQL) → 2차 → 회수(SQL) → 3차.
- 정리: A의 시험 메모는 3차에서 지웠습니다. B의 실측용 메모는 B 계정에 남아 있습니다(내용은 가상 문장). 복구 감사 기록에는 started·restored·rejected가 남습니다(덧붙이기만 하는 표).
- 앞선 실행 중 화면 새로고침으로 키를 잃은 A 기기 `069c2094`는 같은 회수 SQL로 `revoked` 처리했습니다(사용자 확인: 2줄 반환).
- 표의 서버 시각과 화면 시각(JSON의 clientTime)은 약 1분 차이가 있었습니다(사용 PC 시계가 느림). 서명 시각 허용 범위(2분) 안이라 결과에 영향이 없었습니다.
- 원본: `evidence/step12-live-2026-10-15-full.json` (이전 A 단독 실행: `evidence/step12-live-2026-10-15.json`)

| 단계 | 구분 | 요청 | 기대 | 실제 | 요청 ID(x-vercel-id) | 서버 시각(Date) | 판정 |
|---|---|---|---|---|---|---|---|
| 1·2 | 금지 | GET /data.json · 토큰 없음 | 404 | 404 | `icn1::c6h4k-1792026613999-3df2a325f0d6` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 1·2 | 정상 | GET / (화면) · 토큰 없음 | 200 | 200 | `icn1::fdfx5-1792026614013-256a63df0041` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 3 | 금지 | GET /api/notes · 토큰 없음 | 401 LOGIN_REQUIRED | 401 LOGIN_REQUIRED | `icn1::iad1::kqhhz-1792026614037-59bdad845c58` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 3 | 금지 | GET /api/notes · 위조 토큰 | 401 LOGIN_REQUIRED | 401 LOGIN_REQUIRED | `icn1::iad1::vtd5w-1792026614353-bbcbbc2eebe8` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 4 | 정상 | POST /api/notes · 본인 · 서명 | 201 | 201 | `icn1::iad1::7ctvb-1792026615162-160f7a80d643` | Thu, 15 Oct 2026 01:10:16 GMT | 통과 |
| 4 | 정상 | GET /api/notes/{내 시험 메모} · 본인 · 서명 | 200 | 200 | `icn1::iad1::vtd5w-1792026616431-b9aab23dd7d5` | Thu, 15 Oct 2026 01:10:18 GMT | 통과 |
| 4 | 정상 | GET /api/notes · 본인 · 서명 | 200 | 200 | `icn1::iad1::c6h4k-1792026618371-c620f52edfd4` | Thu, 15 Oct 2026 01:10:19 GMT | 통과 |
| 4 | 정상 | PUT /api/notes/{내 시험 메모} · 본인 · 서명 | 200 | 200 | `icn1::iad1::c6h4k-1792026620052-1ce65fdc0f3a` | Thu, 15 Oct 2026 01:10:22 GMT | 통과 |
| 4 | 금지 | GET /api/notes/{남의 메모} · 본인 · 서명 | 403 OWNER_MISMATCH | 403 OWNER_MISMATCH | `icn1::iad1::h72cr-1792026622512-1849487f9285` | Thu, 15 Oct 2026 01:10:23 GMT | 통과 |
| 4 | 금지 | PUT /api/notes/{남의 메모} · 본인 · 서명 | 403 OWNER_MISMATCH | 403 OWNER_MISMATCH | `icn1::iad1::vtd5w-1792026623576-00111ab04ee1` | Thu, 15 Oct 2026 01:10:24 GMT | 통과 |
| 4 | 금지 | DELETE /api/notes/{남의 메모} · 본인 · 서명 | 403 OWNER_MISMATCH | 403 OWNER_MISMATCH | `icn1::iad1::dqbhg-1792026624881-7754bc08fa56` | Thu, 15 Oct 2026 01:10:26 GMT | 통과 |
| 5 | 금지 | 브라우저 공개 키로 Supabase notes 직접 호출 | - | - | - | - | 미실행 |
| 6 | 금지 | GET /api/notes · 본인 토큰 · 기기 서명 없음 | 403 DEVICE_PROOF_REQUIRED | 403 DEVICE_PROOF_REQUIRED | `icn1::c6h4k-1792026614664-b1994eb39e03` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 6 | 금지 | GET /api/notes · 본인 토큰 · 없는 기기 세션으로 서명 | 403 DEVICE_NOT_APPROVED | 403 DEVICE_NOT_APPROVED | `icn1::7ctvb-1792026614888-f7439b455033` | Thu, 15 Oct 2026 01:10:15 GMT | 통과 |
| 6 | 준비 | POST /api/device/key-register · 시험용 기기 키 승인 요청 | 201 · status pending(승인 대기) | 201 · 조건 맞음 | `icn1::iad1::4m42n-1792026651596-caadb09d8041` | Thu, 15 Oct 2026 01:10:52 GMT | 통과 |
| 6 | 금지 | POST /api/device/key-session · 승인 전 시험용 기기 | 200 · approved false, 기기 세션 없음 | 200 · 조건 맞음 | `icn1::iad1::h72cr-1792026654171-8994f670e449` | Thu, 15 Oct 2026 01:10:55 GMT | 통과 |
| 7 | 금지 | 복합 이상 접속 재확인(step_up) | - | - | - | - | 미실행 |
| 8 | 금지 | GET /api/notes?owner_id=… · 본인 · 서명 | 400 QUERY_NOT_ALLOWED | 400 QUERY_NOT_ALLOWED | `icn1::iad1::dqbhg-1792026626266-421aae7734e1` | Thu, 15 Oct 2026 01:10:26 GMT | 통과 |
| 8 | 금지 | POST /api/notes 본문 role · 본인 · 서명 | 403 ROLE_NOT_TRUSTED | 403 ROLE_NOT_TRUSTED | `icn1::iad1::dqbhg-1792026627078-9b95a9e16fb9` | Thu, 15 Oct 2026 01:10:27 GMT | 통과 |
| 8 | 금지 | POST /api/notes 본문 owner_id · 본인 · 서명 | 403 OWNER_MISMATCH | 403 OWNER_MISMATCH | `icn1::iad1::dqbhg-1792026627860-d6fda88933ef` | Thu, 15 Oct 2026 01:10:28 GMT | 통과 |
| 8 | 참고 | GET /api/notices · 본인 토큰 | 404 | 404 | `icn1::dqbhg-1792026628676-0544c874efd2` | Thu, 15 Oct 2026 01:10:28 GMT | 참고(일치) |
| 9 | 금지 | 낯선 네트워크 다량 조회 → 기기 회수 | - | - | - | - | 미실행 |
| 10 | 준비 | PUT /api/notes/{내 시험 메모} · 내용 변조 · 서명 | 200 | 200 | `icn1::iad1::dqbhg-1792026628703-31e0c0dd234f` | Thu, 15 Oct 2026 01:10:29 GMT | 통과 |
| 10 | 정상 | POST /api/restore {내 시험 메모} · 서명 | 200 · 복구 응답 verified 모든 칸 true | 200 · 조건 맞음 | `icn1::iad1::h72cr-1792026629982-23f3dfb174e3` | Thu, 15 Oct 2026 01:10:36 GMT | 통과 |
| 10 | 금지 | POST /api/restore {남의 메모} · 서명 | 404 BACKUP_NOT_FOUND | 404 BACKUP_NOT_FOUND | `icn1::iad1::dqbhg-1792026647595-ba5e71e16917` | Thu, 15 Oct 2026 01:10:48 GMT | 통과 |
| 10 | 금지 | POST /api/restore · 본인 토큰 · 기기 서명 없음 | 403 DEVICE_PROOF_REQUIRED | 403 DEVICE_PROOF_REQUIRED | `icn1::n8sl4-1792026639051-495474200253` | Thu, 15 Oct 2026 01:10:39 GMT | 통과 |
| 10 | 금지 | POST /api/restore 본문 {id, owner_id} · 서명 | 400 INVALID_RESTORE_REQUEST | 400 INVALID_RESTORE_REQUEST | `icn1::iad1::n8sl4-1792026639165-19ad73f7dc72` | Thu, 15 Oct 2026 01:10:40 GMT | 통과 |
| 11 | 정상 | GET /api/notes/{내 시험 메모} · 정상 서명 | 200 | 200 | `icn1::iad1::vtd5w-1792026640188-8e674a01105e` | Thu, 15 Oct 2026 01:10:42 GMT | 통과 |
| 11 | 금지 | {내 시험 메모} 조회로 서명 → 다른 메모 ID로 보냄 | 403 DEVICE_SIGNATURE_INVALID | 403 DEVICE_SIGNATURE_INVALID | `icn1::vtd5w-1792026642691-69db0308c5c9` | Thu, 15 Oct 2026 01:10:43 GMT | 통과 |
| 11 | 금지 | GET으로 서명 → DELETE로 보냄 | 403 DEVICE_SIGNATURE_INVALID | 403 DEVICE_SIGNATURE_INVALID | `icn1::vtd5w-1792026643130-058c15fab87d` | Thu, 15 Oct 2026 01:10:43 GMT | 통과 |
| 11 | 금지 | POST /api/notes로 서명 → POST /api/restore로 보냄(같은 본문) | 403 DEVICE_SIGNATURE_INVALID | 403 DEVICE_SIGNATURE_INVALID | `icn1::vtd5w-1792026643576-923a60a503cc` | Thu, 15 Oct 2026 01:10:44 GMT | 통과 |
| 11 | 금지 | PUT 본문 A로 서명 → 본문 B로 보냄 | 403 DEVICE_SIGNATURE_INVALID | 403 DEVICE_SIGNATURE_INVALID | `icn1::c6h4k-1792026644065-a22963fba843` | Thu, 15 Oct 2026 01:10:44 GMT | 통과 |
| 11 | 정상 | 재전송 시험 1회째(같은 서명 첫 사용) | 200 | 200 | `icn1::iad1::c6h4k-1792026644419-07c559dd8673` | Thu, 15 Oct 2026 01:10:46 GMT | 통과 |
| 11 | 금지 | 재전송 시험 2회째(같은 서명·번호 다시) | 403 DEVICE_PROOF_REPLAYED | 403 DEVICE_PROOF_REPLAYED | `icn1::c6h4k-1792026646872-9c12e7112072` | Thu, 15 Oct 2026 01:10:47 GMT | 통과 |
| 11 | 금지 | 5분 전 시각으로 서명 | 403 DEVICE_PROOF_EXPIRED | 403 DEVICE_PROOF_EXPIRED | `icn1::c6h4k-1792026647494-47fb9e84400e` | Thu, 15 Oct 2026 01:10:47 GMT | 통과 |
| 12 괴물① | 금지 | 괴물 ① 1: GET /api/notes/{남의 메모} · 토큰 없음 | 401 LOGIN_REQUIRED | 401 LOGIN_REQUIRED | `icn1::iad1::kxdsp-1792026648954-34e7b93c9207` | Thu, 15 Oct 2026 01:10:49 GMT | 통과 |
| 12 괴물① | 금지 | 괴물 ① 2(곧바로): GET /api/notes/{남의 메모} · 본인 · 서명 | 403 OWNER_MISMATCH | 403 OWNER_MISMATCH | `icn1::iad1::kxdsp-1792026649275-747a7a5d3aee` | Thu, 15 Oct 2026 01:10:50 GMT | 통과 |
| 12 괴물② | 금지 | 괴물 ② 1: GET /api/notes · 본인 토큰 · 미등록(서명 없음) | 403 DEVICE_PROOF_REQUIRED | 403 DEVICE_PROOF_REQUIRED | `icn1::zt4s2-1792026614773-f6d3bb6477ca` | Thu, 15 Oct 2026 01:10:14 GMT | 통과 |
| 12 괴물③ | 금지 | 괴물 ③ 1(복구 직후): PUT /api/notes/{내 시험 메모} · 본인 토큰 · 서명 없음 | 403 DEVICE_PROOF_REQUIRED | 403 DEVICE_PROOF_REQUIRED | `icn1::c6h4k-1792026636193-a72acd148dd8` | Thu, 15 Oct 2026 01:10:36 GMT | 통과 |
| 12 괴물③ | 참고 | 괴물 ③ 2: GET /api/notices · 본인 토큰 | 404 | 404 | `icn1::c6h4k-1792026636306-f2822dd43221` | Thu, 15 Oct 2026 01:10:36 GMT | 참고(일치) |
| 12 괴물③ | 정상 | 괴물 ③ 뒤: GET /api/notes/{내 시험 메모} · 서명(복구 내용 그대로) | 200 | 200 | `icn1::iad1::fmght-1792026636331-b56beeaf2536` | Thu, 15 Oct 2026 01:10:38 GMT | 통과 |
| 6 | 정상 | POST /api/device/key-session · 승인된 시험용 기기 | 200 · approved true, 기기 세션 있음 | 200 · 조건 맞음 | `icn1::iad1::p56kn-1792026693961-1a8c05f3aedf` | Thu, 15 Oct 2026 01:11:36 GMT | 통과 |
| 6 | 정상 | GET /api/notes/{내 시험 메모} · 시험용 기기 서명 | 200 | 200 | `icn1::iad1::kxdsp-1792026696836-7607ac6fd014` | Thu, 15 Oct 2026 01:11:38 GMT | 통과 |
| 12 괴물② | 금지 | 괴물 ② 2: GET /api/notes/{내 시험 메모} · 회수된 시험용 기기 서명 | 403 DEVICE_NOT_APPROVED | 403 DEVICE_NOT_APPROVED | `icn1::xd5dq-1792026739306-438d79e4b6f0` | Thu, 15 Oct 2026 01:12:19 GMT | 통과 |
| 12 괴물② | 금지 | POST /api/device/key-session · 회수된 시험용 기기 | 200 · status revoked, 기기 세션 없음 | 200 · 조건 맞음 | `icn1::iad1::xd5dq-1792026741083-23548036618f` | Thu, 15 Oct 2026 01:12:22 GMT | 통과 |
| 4 | 정상 | DELETE /api/notes/{내 시험 메모} · 본인 · 서명(시험 메모 정리) | 204 | 204 | `icn1::iad1::h72cr-1792026742505-6b344a7f6022` | Thu, 15 Oct 2026 01:12:24 GMT | 통과 |
| 12 | 금지 | 41종 공격 전체 | - | - | - | - | 미실행 |


## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
