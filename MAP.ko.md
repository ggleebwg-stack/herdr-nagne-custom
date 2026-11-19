# 프로젝트 지도

이 저장소에 무엇이 어디 있는지, 설치하면 어디로 가는지, 실행 중에 서로 어떻게 연결되는지 정리했습니다. 각 mod가 쓰는 API와 상태 키 전체 표는 [영문 MAP](MAP.md#run-time-connections)에 있습니다.

## 파일 구성

```
herdr-nagne-custom/
├── mods/                  herdr 패널(JavaScript)              → ~/.config/herdr-app/mods/
│   ├── workers/           워커 칩 + 고른 워커를 오른쪽 칸에 고정
│   ├── status-plus/       상태바: 사용량 막대, 새로고침, History·Skills 버튼
│   ├── projects/          왼쪽 프로젝트 폴더 목록
│   ├── skills/            Claude Code 스킬 목록, 대기 중인 에이전트에 /스킬 전송
│   └── agent-folders/     Agents 목록을 색깔 폴더로 (kiote/pi-setup 기반, 고지 파일 포함)
├── layouts/
│   └── supervisor.json    mod들을 배치한 창 레이아웃            → ~/.config/herdr-app/layouts/
├── templates/             워커 템플릿                           → Windows %APPDATA%\herdr-core\templates\
│   ├── explore.md         Claude Haiku, plan 모드(읽기 전용)       macOS/Linux ~/.config/herdr-core/templates/
│   ├── spec-check.md      Codex, 읽기 전용, 명세 대조
│   └── astra-review.md    Codex, 읽기 전용, 설계 검토
├── hw                     워커 실행기(bash)                     → ~/.local/bin/hw
├── keys.snippet.json      keys.json에 직접 합칠 단축키
├── scripts/
│   ├── install.sh         저장소 → 이 PC (교체 파일은 ~/.herdr-config-backup/<시각>/ 으로 옮김)
│   ├── export.sh          이 PC → 저장소 (프로젝트 경로는 ~/Projects로 바꿔 저장)
│   └── paths.sh           두 스크립트가 함께 쓰는 경로와 mod 목록
├── docs/                  README 스크린샷 (데모 프로젝트로 촬영)
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
    └── status            ← kit: status-plus (herdr workspace-status 대체)
```

## 실행 흐름

```
herdr 안의 터미널 ── hw <템플릿> <이름> "<작업>" ──► templates/<템플릿>.md
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
| `status-plus.usage.<서비스>` | 마지막으로 받은 사용량 |
| `status-plus.blocked.<서비스>` | 429 응답 뒤 다시 조회할 수 있는 시각 |

## 외부 통신

- **`status-plus`:** `api.anthropic.com`와 `chatgpt.com`의 사용량 조회 주소만 호출합니다. 로그인 정보는 각 CLI가 이미 저장해 둔 것을 씁니다.
- **나머지 mod:** 네트워크를 쓰지 않습니다.
