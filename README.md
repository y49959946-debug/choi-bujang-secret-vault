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

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
