# 프로젝트 지도

이 저장소에 무엇이 어디 있는지, 설치하면 어디로 가는지, 실행 중에 서로 어떻게 연결되는지 정리했습니다. 각 mod가 쓰는 API와 상태 키 전체 표는 [영문 MAP](MAP.md#run-time-connections)에 있습니다.

## 파일 구성

```
herdr-nagne-custom/
├── mods/                  herdr 패널(JavaScript)              → ~/.config/herdr-app/mods/
│   ├── workers/           워커 칩 + 고른 워커를 오른쪽 칸에 고정
│   ├── status-plus/       상태바: 프로바이더별 사용량 칸, 새로고침, History·Skills 버튼
│   ├── providers/         Providers 창: 켜고 끄기, 로그인·로그아웃, OpenRouter 키·모델 (Ctrl+Shift+U)
│   ├── resume/            재부팅 뒤 "Resume agents" 목록 (status-plus의 Resume 칸이나 알림으로 열림)
│   ├── projects/          왼쪽 프로젝트 폴더 목록
│   ├── skills/            Claude Code 스킬 목록, 대기 중인 에이전트에 /스킬 전송
│   └── agent-folders/     Agents 목록을 색깔 폴더로 (kiote/pi-setup 기반, 고지 파일 포함)
├── layouts/
│   └── supervisor.json    mod들을 배치한 창 레이아웃            → ~/.config/herdr-app/layouts/
├── templates/             워커 템플릿                           → Windows %APPDATA%\herdr-core\templates\
│   ├── explore.md         Claude Haiku, 읽기 도구만(셸·편집 없음)       macOS/Linux ~/.config/herdr-core/templates/
│   ├── grok-explore.md    Grok, 읽기 전용 샌드박스(셸 없음)
│   ├── openrouter-explore.md  opencode로 OpenRouter 모델 (모델은 $OPENROUTER_MODEL)
│   ├── spec-check.md      Codex, 읽기 전용, 명세 대조
│   └── astra-review.md    Codex, 읽기 전용, 설계 검토
├── hw                     워커 실행기(bash)                     → ~/.local/bin/hw (Windows는 hw.cmd도)
├── nagne-session-hook     Claude Code 세션 시작·종료 훅(bash)    → ~/.local/bin/
├── herdr-link             Tailscale로 컴퓨터 연결(ssh 없음): 중계 + tailscale serve → ~/.local/bin/
├── claude-hooks.snippet.json  ~/.claude/settings.json에 직접 추가할 훅 두 개
├── hermes/herdr-status/   Hermes Agent 플러그인: 상태를 herdr에 알림(OSC 7501) → <hermes 홈>/plugins/ (--hermes-status)
├── codex.rules            hw와 hc ls/get/wait/read를 Codex 샌드박스 밖에서 실행 허용 → ~/.codex/rules/herdr-nagne.rules (--codex-rules)
├── keys.snippet.json      keys.json에 직접 합칠 단축키
├── providers.example.json 켤 프로바이더와 키 위치          → ~/.config/herdr-nagne/providers.json (없을 때만)
├── bin/install.js         npx가 실행하는 설치기: 저장소 → 이 PC (교체 파일은 ~/.herdr-config-backup/<시각>/ 으로 옮김)
├── bin/compat.js          키트를 검증한 herdr 버전과 이 PC에 설치된 버전
├── package.json           npx 실행 진입점, 배포 파일 목록, "testedWith" (herdr-app, hc)
├── scripts/
│   ├── compat-check.js    herdr 업데이트 후 점검: mod 로드, 명령과 hc 옵션이 그대로 있는지
│   ├── export.sh          이 PC → 저장소 (프로젝트 경로는 ~/Projects로 바꿔 저장)
│   ├── paths.sh           export.sh가 쓰는 경로와 mod 목록
│   └── demo/              stage.js: 별도 데모 창·코어에 스크린샷 장면을 꾸밈.
│                          demo-agent / demo-worker가 에이전트와 워커 대역
├── docs/                  README 스크린샷 (데모 장면에서 잘라냄, 실제 세션은 쓰지 않음)
├── README.md, README.ko.md
├── MAP.md, MAP.ko.md      이 문서
└── LICENSE, NOTICE, LICENSE-Lucide.txt
```

## 레이아웃

`layouts/supervisor.json`은 herdr 기본 `main` 레이아웃에서 아래 블록을 바꾸거나 더한 것입니다.

```
root
├── sidebar
│   ├── spaces            herdr 기본
│   ├── projects          ← kit (props.root = 프로젝트 폴더)
│   └── agents            ← kit: agent-folders (herdr agents 대체)
└── work
    ├── tabs              herdr 기본
    ├── work-body
    │   ├── main          현재 탭의 패널
    │   ├── watch         ← kit: 워커가 있을 때만 보임, Ctrl+Shift+A로 켜고 끔
    │   │   ├── watch-bar     workers mod
    │   │   └── watch-agent   고른 워커 터미널 (workers mod가 만들고 다시 만듦)
    │   └── panel         files / changes (herdr 기본)
    └── status-row
        ├── status            ← kit: status-plus (herdr workspace-status 대체)
        └── workers-toggle    ← kit: workers {toggle}, 항상 보여서 watch 칸을 열고 닫음
```

## 실행 흐름

```
herdr 안의 터미널 ── hw <템플릿> <이름> "<작업>" ──► templates/<템플릿>.md
                                                    │ provider가 providers.json에서 꺼져 있으면 거부
                                                    │ 명령 속 ${변수}는 환경변수, 없으면 providers.json의 "env"로 채움
                                                    │ 명령 + 프롬프트(한 줄로)
                                                    ▼
                          hc run --bg --name <이름> -- <명령> "<프롬프트>"
                                                    │ 워커 터미널 (부모 = 실행한 터미널)
                                                    ▼
   workers mod ◄── 부모가 있는 터미널 목록 ─────── herdr-core (hc)
        │ 칩 클릭
        ▼
   watch-agent 칸에 그 워커 화면을 실시간 표시
   결과 수집: hc wait --children all ; hc read <이름>
```

## 저장되는 상태

herdr의 `~/.config/herdr-app/shared.json`에 저장됩니다. 설치·내보내기 스크립트는 이 파일을 복사하지 않으므로, 아래 값은 PC마다 따로 유지됩니다.

| 키 | 내용 |
|---|---|
| `projects.hidden` | Projects에서 숨긴 폴더 이름 |
| `agentFolders` | 에이전트 폴더 구성 |
| `status-plus.usage.<서비스>` | 마지막으로 받은 사용량 (Providers 창이 로그인 변화 시 지움) |
| `status-plus.blocked.<서비스>` | 429 응답 뒤 다시 조회할 수 있는 시각 |
| `resume.candidates` | 이어갈 수 있는 세션 목록 (status-plus가 만들고 resume mod가 씀) |
| `resume.sent`, `resume.told` | 방금 이어가기를 보낸 칸, 이미 알림을 띄운 세션 |

세션 기록은 `~/.config/herdr-nagne/sessions/<core id>/<터미널>.jsonl`에 줄 단위로 덧붙여집니다. 터미널 주소는 herdr-core마다 따로라서(코어가 둘이면 둘 다 `t1s`가 있음) 코어 ID별 폴더에 나눠 둡니다. 종료 기록이 없는 시작 기록이 "열린 세션"입니다.

## 재부팅 뒤 이어가기

```
 herdr 칸의 claude (환경변수 HC_TERMINAL_ID=t7)
   SessionStart / SessionEnd ──► nagne-session-hook ──► sessions/<core id>/t7.jsonl (덧붙이기만)
 재부팅: herdr-core가 t7 칸을 같은 주소의 빈 셸로 되살림
   status-plus: 열린 세션 + hc ls(칸 있음, 워커 아님, 에이전트 아님) + hc get(맨 앞이 셸) ──► "Resume 1 agent"
   resume mod: Resume 클릭 → 다시 확인 → hc send t7 "claude --resume <id>" (폴더가 다르면 먼저 이동)
```

## 외부 통신

- **`status-plus`:** 켜 둔 프로바이더의 사용량 조회 주소만 호출합니다(`api.anthropic.com`, `chatgpt.com`, `openrouter.ai`). 로그인 정보는 각 CLI가 저장해 둔 것을, OpenRouter는 `providers.json`에 적은 환경변수나 파일의 키를 씁니다. Grok은 로컬 `grok usage --json`만 실행합니다.
- **`providers`:** 로컬 명령만 실행합니다(각 CLI의 상태 확인·로그인·로그아웃). `providers.json`과 `openrouter.key`만 씁니다.
- **나머지 mod:** 네트워크를 쓰지 않습니다.

## 다른 컴퓨터 연결 (Tailscale, ssh 없음)

```
 이 컴퓨터                                             집·회사 컴퓨터 (같은 Tailscale 사용자)
                                                      herdr-link on:
 herdr-link add <이름> <호스트>                          tailscale serve :47710 (tailnet만)
   hc machine add --via                                   → 127.0.0.1:47711 중계 프로그램 (로그인 시 실행)
     'node herdr-link dial <호스트>'  ──Tailscale──►      → tailscale whois: 같은 사용자? 아니면 거부
                                                          → herdr-core connect
 herdr 창: <이름> 컴퓨터의 Space와 터미널  ◄────────  에이전트는 그쪽에서 실행, <이름>/t7로 부름
```
