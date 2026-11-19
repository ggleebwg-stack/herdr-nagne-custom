# herdr-nagne-custom

**에이전트 하나를 돌리면서, 그 하위 에이전트들이 일하는 모습을 옆에서 본다.**
[herdr](https://github.com/herdrdev/herdr-app)를 Claude Code·Codex 워커 감독용 화면으로 바꾸는 레이아웃 하나, mod 다섯 개, 작은 실행기입니다. Windows에서 매일 쓰며 만들었습니다. macOS 경로도 넣었지만 덜 검증됐습니다.

[English README](README.md)

![supervisor 레이아웃: 왼쪽은 워커 두 개를 띄운 셸, 오른쪽은 실시간 워커 칸, 아래는 사용량 막대](docs/supervisor.png)

*목업이 아닌 실제 화면입니다. 왼쪽 셸에서 `hw`로 읽기 전용 Claude Haiku 워커 두 개를 띄웠습니다. 오른쪽 칸은 워커 화면을 실시간으로 보여줍니다. 왼쪽 아래 사용량 막대는 각 회사의 사용량 조회 주소에서 받은 값입니다.*

## 구성

| 구성 | 하는 일 |
|---|---|
| **`supervisor` 레이아웃** | herdr 기본 레이아웃에 오른쪽 **워커 칸**을 더했습니다. 하위 에이전트가 생기면 저절로 열리고, 모두 끝나면 닫힙니다. `Ctrl+Shift+A`로 켜고 끕니다. |
| **`workers` mod** | 워커 칸 위쪽에 실행 중인 워커마다 칩이 하나씩 붙습니다. 칩을 누르면 그 워커 화면이 아래에 고정됩니다. 칩마다 미리보기와 종료 버튼이 있습니다. |
| **`status-plus` mod** | 기본 상태바에 **Claude·Codex 사용량 막대**(5시간, 주간)를 더했습니다. 80% 미만은 초록, 80% 이상은 노랑, 90% 이상은 빨강이고, 초기화까지 남은 시간도 보입니다. 새로고침 버튼이 있고, 다시 불러와도 받아 둔 값을 쓰며, 서버가 429(요청 과다)로 답하면 알려준 시간만큼 기다립니다. |
| **`projects` mod** | 왼쪽에 프로젝트 폴더 목록을 최근 수정 순으로 보여줍니다. 클릭하면 그 폴더에서 작업 중인 Space로 가고, 없으면 새로 엽니다. ×로 목록에서 숨길 수 있고, 디스크의 폴더는 건드리지 않습니다. |
| **`skills` mod** | Claude Code 스킬(개인·프로젝트·플러그인)을 보여주고, `/스킬 인자`를 **대기 중인 에이전트에게만** 보냅니다. |
| **`agent-folders` mod** | Agents 목록을 색깔 폴더로 묶습니다. 끌어다 놓기와 규칙을 지원합니다. [kiote의 mod](https://github.com/kiote/pi-setup/tree/main/herdr/agent-folders)에서 Windows 작업표시줄 점 표시만 뺐습니다. |
| **`hw` + 워커 템플릿** | `hw <템플릿> <이름> "<작업>"`으로 백그라운드 워커를 띄웁니다. 템플릿은 `explore`(Claude Haiku, plan 모드), `spec-check`(Codex, 읽기 전용), `astra-review`(Codex 설계 검토, 읽기 전용) 세 가지입니다. |

## 설치

### 1. herdr 설치

1. **[herdr.dev](https://herdr.dev)**에서 운영체제에 맞는 설치 파일을 받아 실행합니다. 앱이 **herdr-core**(`hc`)도 함께 설치하고, 이후 업데이트도 알아서 합니다.
2. **새** 터미널을 열고 두 프로그램이 잡히는지 확인합니다.
   ```bash
   herdr-app --version   # 0.1.16에서 검증
   hc --version          # 0.1.21에서 검증
   ```

### 2. 함께 쓰는 도구

| 도구 | 쓰는 곳 | 설치 |
|---|---|---|
| bash | `hw`, 설치 스크립트 | Windows: [Git for Windows](https://git-scm.com/download/win)(Git Bash). macOS/Linux: 기본 포함 |
| git | 저장소 받기 | Windows는 위와 같음. macOS: `xcode-select --install` |
| Claude Code | `explore` 워커, Claude 사용량, Skills 패널 | [설치 안내](https://docs.claude.com/en/docs/claude-code/setup). 설치 후 `claude`를 한 번 실행해 로그인 |
| Codex CLI | `spec-check`·`astra-review` 워커, Codex 사용량 | `npm install -g @openai/codex` 후 `codex login` |

쓸 에이전트만 설치하면 됩니다. 로그인하지 않은 서비스는 상태바에 `—`로 표시됩니다.

### 3. kit 설치

Windows는 Git Bash, macOS는 터미널에서 실행합니다.

```bash
git clone <이 저장소 주소> herdr-nagne-custom
cd herdr-nagne-custom
scripts/install.sh --dry-run   # 추가·교체될 파일을 먼저 보여줌
scripts/install.sh             # 교체되는 파일은 ~/.herdr-config-backup/<시각>/ 으로 옮겨 둠(삭제 안 함)
```

설치 스크립트가 복사하는 위치:

| 저장소 | 설치 위치 |
|---|---|
| `herdr-app/mods/*` (mod 5개) | `~/.config/herdr-app/mods/` |
| `herdr-app/layouts/supervisor.json` | `~/.config/herdr-app/layouts/` |
| `herdr-core/templates/*.md` | Windows `%APPDATA%\herdr-core\templates\`, 그 밖 `~/.config/herdr-core/templates/` |
| `bin/hw` | `~/.local/bin/hw` (이 폴더가 PATH에 있어야 함) |

사용자의 `keys.json`과 `settings.json`은 건드리지 않습니다.

### 4. herdr에서 마무리

1. **단축키**: [`herdr-app/keys.snippet.json`](herdr-app/keys.snippet.json)의 항목을 `~/.config/herdr-app/keys.json`에 옮겨 적습니다. `global`은 기존 `global` 안에 합치고, `layout:supervisor` 구역은 새로 추가합니다.
2. **프로젝트 폴더**: `~/.config/herdr-app/layouts/supervisor.json`에서 `"mod": "projects"`를 찾아 `"root"`를 바꿉니다. 기본값은 `"~/Projects"`입니다. Windows 경로는 `"D:\\Code"`처럼 백슬래시를 두 번 씁니다.
3. **레이아웃**: `Ctrl+Shift+L`을 눌러 **supervisor**로 바꿉니다. 또는 `herdr-app do layout.switch '{"name":"supervisor"}'`를 실행합니다.
4. (선택) `~/.config/herdr-app/settings.json`에서 터미널 글꼴(`"font": "D2Coding"`)이나 worktree 위치(`"worktrees": { "directory": "D:\\Code\\.worktrees" }`)를 정할 수 있습니다. Projects 목록은 점(.)으로 시작하는 폴더를 빼고 보여줍니다.

### 5. 동작 확인

- 상태바 왼쪽 아래에 **Claude**, **Codex** 사용량 칸이 보이는지 확인합니다. `—`는 그 CLI에 로그인하지 않았다는 뜻이고, 마우스를 올리면 이유가 나옵니다.
- 인자 없이 `hw`를 실행하면 템플릿 목록이 나옵니다.
- herdr 안의 터미널에서 `hw explore hello "List the top-level folders here"`를 실행합니다. 오른쪽에 워커 칸이 열리고 워커 화면이 실시간으로 보입니다. 새 폴더를 처음 열면 Claude가 폴더를 신뢰하느냐고 묻는데, 워커 화면에서 한 번만 답하면 됩니다.

### 업데이트와 삭제

- **업데이트**: `git pull`한 뒤 `scripts/install.sh`를 다시 실행합니다. 이전 파일은 `~/.herdr-config-backup/<시각>/`에 남습니다.
- **삭제**: `Ctrl+Shift+L`로 `main` 레이아웃으로 돌아갑니다. `~/.config/herdr-app/`에서 `mods/workers`, `mods/projects`, `mods/status-plus`, `mods/skills`, `mods/agent-folders`, `layouts/supervisor.json`을 다른 곳으로 옮기고, 추가한 단축키를 지웁니다. 화면이 깨지면 `Ctrl+Alt+Shift+Esc`로 herdr 기본 레이아웃으로 초기화할 수 있습니다.

### 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| `hc run <템플릿>`이 `sh`를 못 찾음 (Windows) | herdr-core의 알려진 제약입니다. `hw <템플릿> …`을 쓰세요. |
| `hw`가 `no template`라고 함 | Windows 템플릿 위치는 `%APPDATA%\herdr-core\templates`입니다. `scripts/install.sh`를 다시 실행하세요. |
| 사용량 칸이 `—` | 마우스를 올려 이유를 보세요. `not logged in`은 해당 CLI에 로그인하면 되고, `rate limited`는 서버가 기다리라고 한 것이라 시간이 지나면 저절로 다시 조회합니다. |
| 워커가 **blocked**에 멈춤 | 확인 질문(주로 폴더 신뢰)을 기다리는 중입니다. 워커 칩을 눌러 워커 화면에서 답하세요. |
| mod 자리에 오류 상자가 뜸 | `herdr-app check ~/.config/herdr-app/mods/<이름>`을 실행하면 원인이 나옵니다. |

## 워커 감독

```bash
# herdr 안의 아무 터미널에서
hw explore api-map   "Map every HTTP route: method, path, handler file:line"
hw explore cart-spec "Compare src/cart.js with docs/spec.md, list each mismatch"
hc wait --children all        # 모든 워커가 끝날 때까지 대기
hc read --lines 60 cart-spec  # 워커의 마지막 요약 읽기
```

## Windows에서 알아둘 점

- herdr-core가 `sh`를 실행하려고 해서 `hc run <템플릿>`이 실패합니다. 그래서 **`hw`가 템플릿을 직접 읽어** 실행합니다.
- 템플릿 위치는 `~/.config`가 아니라 `%APPDATA%\herdr-core\templates`입니다.
- npm으로 설치한 `codex.cmd`는 줄바꿈이 들어간 인자를 거부합니다. 그래서 `hw`가 프롬프트를 한 줄로 바꿉니다.
- Codex 읽기 전용 샌드박스에서는 `hc` 파이프를 열 수 없습니다. 그래서 워커는 마지막에 요약을 남기고, 부모가 `hc wait`와 `hc read`로 가져갑니다.

## 선택: 세션 히스토리

History 버튼과 `Ctrl+Shift+H`는 [plutotw/herdr-main-usage](https://github.com/plutotw/herdr-main-usage)의 `history` mod를 엽니다. 그 저장소에는 라이선스가 없어서 **이 저장소에 포함하지 않았습니다.** 원본에서 직접 설치하면 버튼이 나타납니다. Windows에서 쓰려면 바꿀 점은 [영문 README](README.md#optional-session-history-panel)에 정리해 두었습니다.

## 통신과 개인정보

- `status-plus`는 Anthropic과 OpenAI의 사용량 조회 주소 두 곳에만 접속합니다. 로그인 정보는 두 CLI가 이미 저장해 둔 것을 읽어서 해당 회사 서버에만 보내고, 따로 저장하거나 기록하지 않습니다.
- 나머지 mod는 네트워크를 쓰지 않습니다.

## 다음 계획 (v0.2)

- Claude·Codex에 이어 Grok과 OpenRouter를 지원합니다.
  - 상태바: 조회할 수 있는 곳은 사용량이나 잔액을 보여줍니다.
  - 워커 템플릿을 추가합니다.
  - `providers.json` 하나로 켜고 끕니다. 키는 환경변수에서 읽고 저장하지 않습니다.
- Tailscale로 연결한 원격 머신(`hc machine add`)을 지원합니다.

## 라이선스

Apache License 2.0입니다. 외부 출처와 고지는 [NOTICE](NOTICE)와 [영문 README](README.md#credits-and-license)에 있습니다.
