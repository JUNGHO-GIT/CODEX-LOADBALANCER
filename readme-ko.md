# codex-loadbalancer

`codex-loadbalancer`는 Codex 및 OpenAI 호환 클라이언트를 위한 Bun 기반 로컬 프록시입니다.
복사한 ChatGPT 계정 토큰을 암호화된 로컬 JSON 저장소에 보관하고, 요청마다 사용 가능한
계정을 선택하며, 필요한 경우 토큰을 갱신한 뒤 Codex 백엔드 API로 요청을 전달합니다.

English documentation: [readme.md](readme.md)

## 현재 범위

이 패키지는 백엔드 우선 구현입니다. 프록시 서버, 로컬 계정 가져오기, 계정 선택, 토큰 갱신,
사용량 기반 cooldown 상태, JSON 로그, 집중 테스트를 포함합니다.

대시보드, OAuth callback UI, 데이터베이스 마이그레이션, 다중 replica 조정, 감사 화면은
아직 포함하지 않습니다.

## 요구 사항

- Bun `1.3.0` 이상
- 로컬 ChatGPT/Codex auth JSON 파일 또는 로컬 API로 입력한 계정 토큰
- 프록시 인증을 켜는 경우 로컬 store에 저장된 API key hash

## 설치

```bash
bun add @jungho-dev/codex-loadbalancer
```

일회성 실행:

```bash
bunx @jungho-dev/codex-loadbalancer
```

전역 npm 설치:

```bash
npm install -g @jungho-dev/codex-loadbalancer
```

저장소에서 직접 실행:

```bash
bun install
bun run build
bun run check
bun test
bun start
```

기본 서버:

```text
http://127.0.0.1:58557
```

## 빠른 시작

Codex auth JSON 파일을 로컬 디렉터리로 복사하고 서버가 그 디렉터리를 읽게 합니다.

```powershell
Copy-Item -LiteralPath "$HOME\.codex\auth" -Destination ".\auth" -Recurse
$env:CODEX_LB_AUTH_DIR = "$PWD\auth"
codex-loadbalancer
```

서버는 `CODEX_LB_AUTH_DIR` 아래의 `.json` 파일을 암호화된 로컬 store로 가져옵니다.
반복 실행해도 같은 안정 account ID를 갱신하므로 중복 계정을 만들지 않습니다.

## 프록시 대상

Codex/OpenAI 호환 클라이언트는 다음 route 계열 중 하나를 사용합니다.

```text
http://127.0.0.1:58557/backend-api/codex
http://127.0.0.1:58557/v1
```

프록시는 prefix 뒤의 요청 path를 유지하고 선택된 계정 access token으로 upstream에 전달합니다.

## 계정 API

가져온 계정 조회:

```bash
curl http://127.0.0.1:58557/api/accounts
```

계정 수동 생성 또는 갱신:

```bash
curl -X POST http://127.0.0.1:58557/api/accounts \
  -H "content-type: application/json" \
  -d "{\"email\":\"me@example.com\",\"accessToken\":\"...\",\"refreshToken\":\"...\",\"idToken\":\"...\"}"
```

저장된 토큰은 `CODEX_LB_ENCRYPTION_KEY_FILE`의 로컬 키로 암호화됩니다.
계정 metadata와 API key hash는 `CODEX_LB_STORE_PATH`에 저장됩니다.

## 프록시 인증

로컬 프록시 API key 검사는 기본값으로 꺼져 있습니다.

활성화:

```text
CODEX_LB_API_KEY_AUTH_ENABLED=true
```

요청 header:

```text
Authorization: Bearer sk-clb-...
```

서버는 bearer token의 SHA-256 hash를 `store.json`의 enabled API key 항목과 비교합니다.

## 라우팅 동작

- active 계정은 cooldown 상태, 사용량 비율, 마지막 선택 시각 기준으로 정렬됩니다.
- primary 계정을 먼저 시도합니다.
- primary 계정이 rate limit이면 나머지 후보를 병렬 race로 시도합니다.
- `401` 응답은 강제 토큰 갱신 후 해당 계정으로 한 번 재시도합니다.
- rate-limit 응답은 header 또는 JSON payload에서 cooldown 상태를 갱신합니다.
- 영구적으로 잘못된 refresh token은 해당 계정을 비활성화합니다.

## 환경 변수

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_LB_HOST` | `127.0.0.1` | bind host |
| `CODEX_LB_PORT` | `58557` | bind port |
| `CODEX_LB_HOME` | `~/.codex-loadbalancer` | runtime home |
| `CODEX_LB_STORE_PATH` | `$CODEX_LB_HOME/store.json` | 계정 및 API key store |
| `CODEX_LB_ENCRYPTION_KEY_FILE` | `$CODEX_LB_HOME/encryption.key` | 로컬 토큰 암호화 키 |
| `CODEX_LB_AUTH_DIR` | unset | 복사한 Codex auth JSON 디렉터리 |
| `CODEX_LB_UPSTREAM_BASE_URL` | `https://chatgpt.com/backend-api/codex` | Codex upstream base URL |
| `CODEX_LB_AUTH_BASE_URL` | `https://auth.openai.com` | OAuth token refresh base URL |
| `CODEX_LB_TOKEN_REFRESH_INTERVAL_DAYS` | `8` | 일반 갱신 주기 |
| `CODEX_LB_TOKEN_REFRESH_TIMEOUT_SECONDS` | `8` | 갱신 요청 timeout |
| `CODEX_LB_PROXY_REQUEST_BUDGET_SECONDS` | `600` | 프록시 요청 예산 |
| `CODEX_LB_PROXY_MAX_BODY_BYTES` | `10485760` | 프록시 요청 본문 최대 크기 |
| `CODEX_LB_USAGE_POLL_CONCURRENCY` | `2` | 사용량 폴링 계정 동시성 |
| `CODEX_LB_USAGE_POLL_JITTER_MS` | `5000` | 사용량 폴링 재시도 jitter |
| `CODEX_LB_API_KEY_AUTH_ENABLED` | `false` | 로컬 프록시 bearer-token gate |
| `CODEX_LB_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `CODEX_LB_LOG_FILE` | `$CODEX_LB_HOME/proxy.log` | JSON 로그 파일 sink |

## 로그

로그는 newline-delimited JSON입니다. 토큰 형태의 필드는 출력 전에 redaction 처리됩니다.

계정 선택, upstream 호출, route 흐름을 추적할 때 debug 로그를 사용합니다.

```powershell
$env:CODEX_LB_LOG_LEVEL = "debug"
```

## 프로젝트 구조

```text
src/assets/scripts/       config, encryption, structured logger
src/assets/type/domain/   shared domain and payload types
src/repositories/         encrypted JSON store facade
src/services/             account import, token refresh, routing, proxy, usage
src/routers/              HTTP routing and request logging
src/index.ts              process bootstrap and server start
tests/                    focused behavior tests
```

## 추가 문서

- [architecture.md](architecture.md)
- [architecture.ko.md](architecture-ko.md)
