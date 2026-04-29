# codex-loadbalancer 아키텍처

English version: [architecture.md](architecture.md)

## 시스템 맵

```text
Codex/OpenAI client
        |
        | HTTP
        v
src/index.ts
        |
        v
src/routers/server.ts
        |
        +--> /health/live
        |
        +--> /api/accounts
        |        |
        |        v
        |   src/services/auth.ts
        |        |
        |        v
        |   src/repositories/store.ts
        |
        +--> /backend-api/codex/* and /v1/*
                 |
                 v
            src/services/proxy.ts
                 |
                 +--> src/services/balancer.ts
                 +--> src/services/auth.ts
                 +--> src/repositories/store.ts
                 |
                 v
            ChatGPT Codex upstream
```

## 런타임 책임

| Area | File | Responsibility |
| --- | --- | --- |
| Bootstrap | `src/index.ts` | 설정 로드, logger 생성, store 로드, auth import, 서버 시작 |
| Configuration | `src/assets/scripts/config.ts` | 환경 변수, runtime path, encryption key 위치 해석 |
| Logging | `src/assets/scripts/logger.ts` | redaction 포함 structured JSON 로그 출력 |
| HTTP routes | `src/routers/server.ts` | health, account API, proxy traffic 라우팅 |
| Store | `src/repositories/store.ts` | read-through JSON cache와 지연 atomic persistence |
| Account import | `src/services/codex-auth.ts` | 복사한 Codex auth JSON을 안정 local account로 변환 |
| Token lifecycle | `src/services/auth.ts` | 암호화된 계정 생성과 access token refresh |
| Load balancing | `src/services/balancer.ts` | cooldown, usage, rotation 기준 active account 정렬 |
| Proxy | `src/services/proxy.ts` | local API key 검증, 계정 선택, refresh retry, response forwarding |
| Usage | `src/services/usage.ts` | upstream usage window 조회 및 계정 상태 반영 |

## 요청 흐름

```text
1. Client가 /backend-api/codex/* 또는 /v1/* 로 요청합니다.
2. server.ts가 request-scoped logger를 붙이고 proxyRequest()를 호출합니다.
3. proxy.ts가 선택적 local bearer token을 검증합니다.
4. Store가 memory에서 현재 account list를 반환합니다.
5. balancer.ts가 active account를 정렬합니다.
6. proxy.ts가 선택된 account access token으로 upstream에 요청합니다.
7. 성공한 upstream response는 client로 stream됩니다.
8. primary account가 rate limit이면 cooldown을 갱신하고 나머지 account를 병렬 race합니다.
9. 401 response는 token refresh를 강제하고 같은 account로 한 번 재시도합니다.
10. 최종 success, rate-limit, upstream failure를 OpenAI 호환 형태로 반환합니다.
```

## 계정 가져오기 흐름

```text
CODEX_LB_AUTH_DIR
        |
        v
codex-auth.ts
        |
        +--> read *.json files
        +--> extract access_token, refresh_token, id_token, account_id
        +--> derive stable account ID from file name
        +--> encrypt tokens
        v
store.ts
        |
        v
store.json
```

account ID는 auth 파일명에서 만들어지므로 import는 idempotent입니다.

## Store 모델

Store는 다음 top-level 구조의 로컬 JSON입니다.

```json
{
  "accounts": [],
  "apiKeys": []
}
```

`store.ts`는 파일을 한 번 hydrate하고, 요청 경로의 read를 memory에서 처리하며, write 이후
지연 flush를 예약합니다. 저장은 임시 파일을 쓴 뒤 atomic rename으로 마무리합니다.

토큰 필드는 store에 들어가기 전에 암호화됩니다. API key는 SHA-256 hash로 저장됩니다.

## 선택 모델

```text
active account set
        |
        v
rank by:
  1. no active cooldown before active cooldown
  2. lower secondary or primary usage percentage
  3. older lastSelectedAt
        |
        v
primary attempt
        |
        +--> success: record success and stream response
        +--> 401: refresh token and retry once
        +--> 429: mark cooldown and race remaining accounts
        +--> error: record transient error and try remaining accounts
```

영구 비활성 계정만 제외됩니다. cooldown 계정은 제거하지 않고 우선순위만 낮춥니다.
따라서 더 좋은 후보가 없을 때는 해당 계정도 다시 시도할 수 있습니다.

## 보안 경계

- Token plaintext는 import, refresh, upstream request dispatch 중에만 필요합니다.
- 저장된 access, refresh, ID token은 로컬 32-byte key로 암호화됩니다.
- local proxy API key는 선택 사항이며 hash로만 저장됩니다.
- 로그는 console 또는 file sink에 쓰기 전에 token-like field를 redaction 처리합니다.
- `store.json`, `encryption.key` 같은 runtime 파일은 npm package에 포함하지 않습니다.

## 패키지 경계

npm package는 Bun 실행 엔트리, 번들 런타임, 문서만 배포합니다.

```text
bin/
dist/
readme.md
readme.ko.md
architecture.md
architecture.ko.md
changelog.md
license.md
```

로컬 runtime artifact, test, client asset, cache, store, encryption key는 package 밖에 둡니다.

## 검증 표면

현재 집중 검증 명령:

```bash
bun run build
bun run check
bun test
npm pack --dry-run
```

`bun run build`는 Bun 번들 엔트리를 검증합니다. `bun run check`는 TypeScript를 검증합니다.
`bun test`는 account ranking, auth import, proxy fallback 동작을 검증합니다.
`npm pack --dry-run`은 publish file list를 확인합니다.
