# COURTSIDE v1.0 — 무료 공개형 농구 점수판

태블릿은 전광판, 스마트폰은 조작기. **경기별 독립 코드와 PIN**을 발급하는 Node.js + WebSocket 기반 공개 베타입니다.

## 주요 기능

- `/`에서 새 경기 생성 및 기존 경기 입장 (로그인 없이 사용)
- 경기마다 별도 8자리 코드, 별도 6자리 조작 PIN
- `/r/경기코드/board`: 관람 전용 전광판, PIN 불필요
- `/r/경기코드/control`: 조작기, 해당 경기 PIN 필요
- 자동 공격권/24초 전환, 시간 리셋, 점수 초기화, 개별 타이머, 부저, 쿼터, 파울·작전타임
- 조작기 내 기록 탭: 실시간 이벤트, 쿼터별 득점, 흐름 그래프, 저장된 경기 결과
- 같은 경기의 스마트폰 1대만 조작, 새로고침 재연결과 조작권 회수
- 경기별 데이터 파일 `room-data/XXXXXXXX.json` (각 경기 다른 파일)

## 로컬 실행

Node.js 20 이상 필요.

```powershell
npm.cmd install
npm.cmd start
```

`http://localhost:3000`에 접속해서 새 경기를 만들고, 생성된 전광판/조작기 링크를 각각 열어 테스트합니다. Linux/macOS는 `npm install && npm start`.

## 기존 GitHub → Render 업그레이드

1. 중요한 현재 경기 기록은 조작기의 **기록 → 기록 JSON 내보내기**로 백업.
2. GitHub `basketball-scoreboard` 저장소 루트에 `server.js`, `package.json`, `README.md`, `.gitignore` 교체.
3. `public/index.html`, `public/client.js` 교체하고, `public/landing.html`을 **추가**. `public/preview-board.png`, `public/preview-control.png`는 유지.
4. `package-lock.json`은 이 배포물에는 포함하지 않았습니다. 이전 버전의 `package-lock.json`이 남아 있으면 새 `package.json`과 일치하지 않을 수 있으므로 **삭제**하거나 새로 `npm install --package-lock-only`로 생성해 갱신하세요. Render Build Command는 기존대로 `npm install` 사용 가능합니다.
5. Render 자동 배포 완료 후 메인 주소 `https://basketball-scoreboard-wvvd.onrender.com/` 접속.
6. 새 경기 생성 → 경기 코드 및 PIN 별도 보관 → 두 화면 각각 접속 → PIN 인증/점수/기록 검증.

**이전 버전의 `/board` 및 `/control` 주소는 이제 메인 페이지로 이동합니다.** 기존 단일 경기 데이터는 새 공개 버전의 여러 방으로 자동 이전되지 않습니다. 옛 환경변수 `CONTROL_PIN`은 v1.0의 경기별 PIN에는 사용되지 않습니다.

## 공개 베타 제한 및 안전

- **Render Free 로컬 파일은 영구 저장소가 아닙니다.** 인스턴스 절전/재시작·재배포 시 방 코드·PIN·점수·기록이 사라질 수 있습니다. 무료 호스팅 테스트용으로만 사용하고, 중요한 경기는 JSON으로 내보내세요. 실제 서비스를 안정적으로 공개하려면 PostgreSQL 같은 영구 저장소가 필요합니다.
- 공개 베타는 서버당 최대 100개 경기, 동일 IP에서 시간당 최대 5개 경기 생성 제한이 있습니다. 스팸 방지 최소한의 제한이며 상용 보안 수준은 아닙니다.
- 전광판 URL을 가진 누구나 해당 경기 점수와 기록을 볼 수 있습니다. PIN은 생성 직후에만 표시되며 서버 저장 시 `scrypt` 해시로 보관합니다. 링크 및 PIN을 공개 채팅에 함께 게시하지 마세요.
- 경기 전광판 영상·부저·시간 기능은 브라우저 환경에 따라 달라질 수 있습니다. 실전 경기 전 기기별 테스트가 필요합니다.
- 서버는 경기 중 계속 실행되어야 하고 인터넷 연결이 필요합니다.
- 이전 v0.4.x와 달리 v1.0 로그에는 PIN이 출력되지 않습니다.

## 서버 구조

`POST /api/rooms` → `{code,pin,board,control}`. 서버의 WebSocket 엔드포인트 `/ws?room=XXXXXXXX`를 통해 모든 조작과 상태가 해당 경기 방에만 한정됩니다. 경기 로직, 클라이언트 관리, PIN 검증, 로그/저장 파일이 각각 분리됩니다.

개발 중인 프로젝트이므로 실제 공식 경기 사용 전 충분히 검증해 주세요.
