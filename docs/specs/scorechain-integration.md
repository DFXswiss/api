# Specification: Scorechain Wallet-Screening & Transaction-Monitoring Integration

> **Status:** Draft – for review. No implementation has started.
> This specification is reviewed and approved **before** any code is written.

| | |
|---|---|
| **Date** | 2026-06-30 |
| **Target repo** | `DFXswiss/api` |
| **Provider** | Scorechain – crypto-asset analytics / AML-KYT |
| **API docs** | https://tech-doc.api.scorechain.com/ (OpenAPI: `…/api.yaml`) |
| **Relation to existing code** | Complements the existing `src/integration/ikna` screening; does **not** replace it |

---

## 1. Motivation & Context

DFX integrates the Scorechain blockchain-analytics API to strengthen monitoring and
risk-scoring of crypto fund flows.

Each call returns **Scorechain's own risk assessment of one specific object** — a score plus
rationale (exposure breakdown, severity, scenario matches) for that exact transaction
(incoming) or destination address (outgoing). This is **one provider's signal, not an
authoritative AML or sanctions determination**. The results are used as an **additional
advisory input** feeding the existing AML decision flow — alongside the independent `ikna`
screening — with a human reviewer / the AML flow keeping the decision (see §8). Every
screening is persisted for a documented audit trail.

The integration is delivered as a **complete, end-to-end integration** (not a stub): scoring
*and* deposit/withdrawal monitoring, plus alert handling and response-signature
verification. Per the agreed process this is split into exactly **two PRs** — this
specification, then a single implementation PR (see §11).

## 2. Goals & Non-Goals

### Goals
- G1. Add a `ScorechainModule` under `src/integration/scorechain/` following the existing
  integration conventions (cf. `src/integration/ikna`).
- G2. On-demand **risk scoring** of addresses, wallets and transactions via
  `/scoringAnalysis`.
- G3. **Screen crypto deposits and withdrawals**: a **synchronous** `scoringAnalysis` gate
  before release, plus — optionally — the **asynchronous** TMS workflow
  (`/registerDeposit` / `/registerWithdrawal` → scenarios/alerts), wired into the existing
  payin / payout flows.
- G4. **Alert handling**: receive TMS scenario alerts and surface them to AML.
- G5. **Response-signature verification** (proof of authenticity) on every response.
- G6. Persist screening results (entity + repository) for audit trail and to **cache**
  against the monthly screening quota.
- G7. Feed risk results into the existing AML decision flow (`src/subdomains/core/aml`)
  in a non-breaking, additive way.

### Non-Goals (this integration)
- N1. Replacing `ikna` screening. Scorechain runs **in parallel**; consolidation is a
  later, separate decision.
- N2. Replacing the Scorechain web app. Operators keep using the dashboard for manual
  investigations; this spec covers the **API** integration only.
- N3. Travel Rule (separate, not in scope).
- N4. Fireblocks auto-freeze (Scorechain supports it, but DFX does not use Fireblocks).
- N5. Automatic block/reject without human review — scores **inform**, they do not
  auto-reject (see §8).

## 3. Scorechain API (reference — DFX-relevant surface)

> Paths and parameter names below are taken from the provider OpenAPI spec
> (`https://tech-doc.api.scorechain.com/api.yaml`). Endpoints outside this subset exist but
> are out of DFX scope.

| Capability | Endpoint(s) | Use in DFX |
|---|---|---|
| Risk scoring | `POST /scoringAnalysis`, `POST /scoringAnalysis/evmPortfolio` | Score address/wallet/tx on demand |
| Transaction monitoring (TMS) | `POST /registerDeposit`, `POST /registerWithdrawal` | Screen crypto in-/out-flows |
| Scenario alerts | `GET /scenarios/alerts`, `GET /scenarios/{scenarioId}/alerts`, `GET /scenarios/checks` | Retrieve TMS alerts / check status |
| Alert push | `ScenarioAlertCallback` (webhook) | Provider pushes alert on scenario match |
| Signature keys | `GET /publicKeys` | Fetch keys to verify response signatures |
| Reports & audit | `GET /reports`, `GET /reports/{reportId}/files/{fileName}` | Documented evidence |
| Health / account | `GET /status`, `GET /me` | Health check; account info / API-key validation |

### Authentication
- API key sent in the request header **`X-API-KEY`**. (`ApiKeyAuth` is only the OpenAPI
  *security-scheme* identifier — the on-the-wire header is `X-API-KEY`, per
  `components.securitySchemes.ApiKeyAuth.name`.)
- The key is generated **once** in the Scorechain workspace (admin), shown only once →
  stored as a deployment secret (see §7). It is not sent by the provider via email.

### Proof of authenticity (response signature)
- Algorithm **RSA-SHA256** (RSASSA-PKCS1-v1_5, RFC 8017).
- Response headers: **`X-Signature`** (signature), **`X-Server-Time`** (UNIX server time).
- Public key from **`GET /publicKeys`** (camelCase).
- A provider JS SDK validates this; DFX may validate manually with Node `crypto` to avoid
  the extra dependency — open decision (§12, Q3).

### Supported blockchains (relevant subset for DFX)
BITCOIN, ETHEREUM, ARBITRUMONE, BASE, OPTIMISM, POLYGON, BSC, SOLANA, TRON, LITECOIN,
BITCOINCASH, DOGECOIN, RIPPLE, … (full list via `GET /blockchains`). A mapping from the DFX
`Blockchain` enum → Scorechain identifiers is required, e.g. `Blockchain.ARBITRUM`
(`'Arbitrum'`) → `'ARBITRUMONE'` (see §6).

### `scoringAnalysis` parameters
- `analysisType`: `ASSIGNED` (entity only) | `INCOMING` (sources) | `OUTGOING`
  (destinations) | `FULL` (complete profile).
- `objectType`: `ADDRESS` | `TRANSACTION` (also `WALLET`; NFT object types out of scope).
- `blockchain`, `coin` (`ALL` | `MAIN` | `STABLE` | `coinChainId`), `depth` (≤100 UTXO /
  ≤6 account-based).

### `registerDeposit` parameters
- Required: `blockchain`, `hash`, `depositAddress`. Optional: `customerRefId` (defaults to
  the address). Triggers configured TMS scenarios; on match an **alert** is pushed via the
  callback / retrievable via the alert endpoints.

### `registerWithdrawal` parameters
- Required: `blockchain`, `withdrawAddress`, `amount`, `coinChainId` (token contract or
  `MAIN`). Optional: `identifier` (UUID; auto-generated if omitted).
- **Asynchronous, no synchronous verdict:** the 200 response (`PendingWithdrawal`) contains
  only `blockchain` + `identifier`. It queues the withdrawal for TMS scenario evaluation;
  the result arrives later via `GET /scenarios/checks` (`QUEUED → PROCESSED`) or the
  `ScenarioAlertCallback` webhook. Does **not** trigger `TX_PATTERN`/Structuring scenarios.
  Both `register*` endpoints are a license-gated TMS feature (`NotIncludedInLicense`).
- For a **synchronous** go/no-go before releasing a payout, use `scoringAnalysis` on the
  destination address instead (see §4.2 / §5).

## 4. Architecture

### 4.1 Module placement
Mirror the existing integration layout (cf. `src/integration/ikna`):

```
src/integration/scorechain/
  scorechain.module.ts
  services/
    scorechain.service.ts            # low-level API client (HttpService + signature verify)
    scorechain-screening.service.ts  # domain logic: scoring, caching, mapping to AML
  controllers/
    scorechain.controller.ts         # admin/manual endpoints (ApiExcludeEndpoint, RoleGuard ADMIN)
    scorechain-webhook.controller.ts # TMS alert webhook receiver
  dto/
    scoring-analysis.dto.ts
    register-deposit.dto.ts
    register-withdrawal.dto.ts
    scorechain-alert.dto.ts
    scorechain-blockchain.enum.ts    # provider blockchain ids + DFX-enum mapping
  entities/
    scorechain-screening.entity.ts   # persisted result (audit + cache)
  repositories/
    scorechain-screening.repository.ts
```

- `ScorechainService` uses the shared `HttpService` (`get<T>` / `post<T>`), with the base
  URL held as a `private readonly baseUrl` in the service and the `X-API-KEY` header built
  from `Config.scorechain` — same pattern as `IknaService` (own `baseUrl`, reads
  `Config.ikna`).
- Registered in `src/integration/integration.module.ts` alongside `IknaModule`.
- An integration module owning its own persisted entity is established practice
  (cf. `src/integration/sift/entities/sift-error-log.entity.ts`,
  `src/integration/exchange/entities/exchange-tx.entity.ts`), so the
  `scorechain_screening` entity living under `src/integration/scorechain/entities/` is
  convention-conform.

### 4.2 Where it plugs into the existing flow

```
                      ┌─────────────────────────────────────────────┐
  Crypto deposit  ──► │ sell-crypto / buy-crypto-swap → payin        │
  (crypto in)         │   pay-in: scoringAnalysis gate (+async TMS)  │──► Scorechain
                      └─────────────────────────────────────────────┘
                                          │ score (sync) / alert (async)
                                          ▼
                      ┌─────────────────────────────────────────────┐
                      │ AML (src/subdomains/core/aml)                │
                      │   AmlError → CheckStatus.PENDING / manual    │
                      └─────────────────────────────────────────────┘
                                          ▲
  Crypto withdrawal ─► scoringAnalysis(ADDRESS) gate (sync) before payout
  (crypto out)         buy-crypto + supporting/payout  [+ async registerWithdrawal]
```

- **Deposit screening** — crypto **in** = `sell-crypto` (customer sells/swaps → `cryptoInput`,
  fiat out), plus the buy-crypto *swap* route (also `cryptoInput`): on confirmed pay-in
  (payin detects the `CryptoInput`), the **synchronous** verdict comes from
  `scoringAnalysis(objectType=TRANSACTION, analysisType=INCOMING)`. `registerDeposit` is used
  **additionally** to feed the async TMS workflow (scenario rules, alerts, audit) — it is not
  a synchronous score.
- **Withdrawal screening** — crypto **out** = `buy-crypto` (buy + swap → crypto `outputAsset`):
  the **synchronous pre-payout gate** is `scoringAnalysis(objectType=ADDRESS)` on the
  destination address (`analysisType=ASSIGNED` for a quick flag, or `OUTGOING` for recipient
  exposure — same 1-check cost). `registerWithdrawal` only returns a tracking UUID and is
  evaluated **asynchronously** (poll `GET /scenarios/checks` or the `ScenarioAlertCallback`
  webhook), so it is used **additionally** for the full TMS workflow — never as the release
  gate.
- **AML coupling**: results map onto the AML flow. The existing `IknaService` is built but
  **not wired** into AML; this spec defines the wiring explicitly for Scorechain (see §8).

> NOTE: exact call-sites (service + method) on the sell-crypto / buy-crypto / payout paths
> are to be pinned during review (open question §12, Q6) — listed here as integration
> points, not final line references.

## 5. Functional scope (full integration, single implementation PR)

| # | Feature | Endpoint | Trigger |
|---|---|---|---|
| F1 | Address/wallet risk score (on demand, admin) | `/scoringAnalysis` | Admin endpoint / manual AML review |
| F2 | Deposit risk score (synchronous gate) | `/scoringAnalysis` (`objectType=TRANSACTION`, `INCOMING`) | On confirmed crypto pay-in |
| F3 | Withdrawal risk score (synchronous pre-payout gate) | `/scoringAnalysis` (`objectType=ADDRESS`) | Before crypto payout release |
| F4 | Async TMS workflow (additional) | `/registerDeposit`, `/registerWithdrawal` + `/scenarios/checks` | Feed scenario rules / alerts / audit |
| F5 | Alert ingestion | `ScenarioAlertCallback` webhook + `/scenarios/{scenarioId}/alerts` | Scorechain pushes alert |
| F6 | Response-signature verification | `/publicKeys` | Every response |
| F7 | Screening persistence + cache | (internal) | Every screening |
| F8 | Quota guard | internal counter | Before each billable call |
| F9 | Health check | `/status` | Monitoring module |
| F10 | Reports (audit evidence) | `/reports`, `/reports/{reportId}/files/{fileName}` | On demand (compliance) |

## 6. Data model

`scorechain_screening` entity (audit trail + cache):

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `objectType` | enum | ADDRESS / WALLET / TRANSACTION |
| `objectId` | string | address or tx hash |
| `blockchain` | string | DFX `Blockchain` enum value |
| `analysisType` | enum | ASSIGNED / INCOMING / OUTGOING / FULL |
| `riskScore` | number | Scorechain score |
| `severity` | string | provider severity level |
| `riskIndicators` | string (JSON) | exposure breakdown / AML indicators |
| `rawResponse` | string (JSON) | full response (signed) for audit |
| `signatureValid` | boolean | result of X-Signature verification |
| `scorechainRef` | string | identifier / customerRefId / alert id |
| `context` | enum | DEPOSIT / WITHDRAWAL / MANUAL |
| `created` / `updated` | datetime | standard DFX columns |

- **JSON columns** (`riskIndicators`, `rawResponse`) follow the DFX canonical pattern from
  CONTRIBUTING: stored as `@Column({ type: 'text', nullable: true })` **strings** with a
  typed getter/setter (`JSON.parse` / `JSON.stringify`); business logic never touches the
  raw string. Not a native `json` column type. (`length: 'MAX'` is a dead MSSQL idiom —
  banned in this PostgreSQL codebase; cf. `sift-error-log.entity.ts` using `type: 'text'`.)
- **Migration**: generated via `npm run migration <PascalName>` (TypeORM), committed in the
  **same PR** as the entity change. Migrations are immutable once on `develop`/`main` —
  fixes go in a follow-up migration (CONTRIBUTING §"Database Migrations").
- **Cache key**: `(objectType, objectId, blockchain, analysisType)` with a configurable TTL
  to avoid re-billing identical screenings within the quota window.
- **Blockchain mapping**: a single source-of-truth map `DFX Blockchain → Scorechain id`
  (e.g. `Blockchain.ARBITRUM → 'ARBITRUMONE'`). Unsupported chains are skipped with a
  logged, explicit `not-supported` result (no silent pass).

## 7. Configuration & secrets

Add a flat config block to `src/config/config.ts`, matching the existing `ikna` / `sift` /
`tatum` style (plain env-backed keys, no nested objects):

```ts
scorechain = {
  apiKey: process.env.SCORECHAIN_API_KEY,
  webhookSecret: process.env.SCORECHAIN_WEBHOOK_SECRET,
  publicKey: process.env.SCORECHAIN_PUBLIC_KEY, // cached from /publicKeys (optional)
};
```

The `X-API-KEY` header is built in the service (`{ 'X-API-KEY': Config.scorechain.apiKey }`)
and the base URL is a `private readonly baseUrl` in `ScorechainService` — consistent with
how `IknaService` holds its own base URL and `Config.ikna` holds only the credential.

- `SCORECHAIN_API_KEY`: the once-shown key, stored as a deployment secret. Never logged,
  never committed.
- Webhook receiver authenticated (shared secret / signature) — public endpoint hardening.
- Document required env vars in the deployment config / key vault.

## 8. AML decision mapping

The integration is **advisory** — Scorechain informs, a human decides. No new auto-reject
path.

- **Mechanism — the outcome layer, not the static `AmlRule` switch:** a screening result
  above a configurable risk threshold (or a TMS alert) produces an `AmlError`;
  `aml-error.enum.ts` maps it to `{ amlCheck: CheckStatus.PENDING, amlReason: … }`, so the
  transaction lands in **manual review** rather than being auto-blocked. The existing
  `AmlError.FORCE_MANUAL_CHECK` (→ `CheckStatus.PENDING` + `AmlReason.MANUAL_CHECK`) is the
  analogous outcome.
- This is deliberately **not** modelled as an `AmlRule`. `AmlRule` is a statically
  configured rule set on master data (asset / IBAN-country / wallet / nationality),
  evaluated in `amlRuleCheck()` over the transaction's own fields with **no external
  input**. A Scorechain result is a dynamic, per-transaction external signal, so it wires
  into the runtime **outcome layer** (`AmlError` → `AmlReason`/`CheckStatus`), not the rule
  switch.
- Reuse `AmlError.FORCE_MANUAL_CHECK` / `AmlReason.MANUAL_CHECK`, or add a dedicated
  Scorechain `AmlError` + `AmlReason` mapped to `CheckStatus.PENDING` — **open decision**
  for review (§12, Q1).
- Sanction hits (if Scorechain flags a sanctioned counterparty) are surfaced through the
  existing sanction path in `src/subdomains/core/aml/services/sanction.service.ts` **for
  review** — this remains Scorechain's labelling, an advisory signal, not a definitive
  sanctions ruling (consistent with §1).
- Thresholds are **config-driven**, not hard-coded, so compliance can tune without a deploy.

## 9. Quota, cost & resilience

- The provider license includes a **finite monthly screening quota** (a single full
  screening can consume more than one billable check). Quota management and result caching
  are therefore first-class requirements, not optimizations.
- **Quota guard** (G6/F8): the API exposes no remaining-quota field, so DFX tracks
  consumption itself — a counter (DB or cache) tracks billable checks vs. the monthly cap;
  near-limit behaviour is explicit (alert + degrade to cached/skip, never silently drop
  screening).
- **Caching** (§6) is the primary cost lever.
- **Failure handling**: Scorechain unavailable must **not** silently pass a transaction.
  Mirror `IknaService` which throws `ServiceUnavailableException`; a failed screening →
  manual review (fail-closed) — recommended — vs. retry queue (open decision §12, Q4).
- **Idempotency**: `registerWithdrawal` supports an `identifier` (UUID); use a deterministic
  id per payout to avoid duplicates on retry.
- `/status` polled by the existing `monitoring` subdomain.

## 10. Security & compliance

- Verify **every** response signature (§3); reject/flag responses failing verification
  (`signatureValid=false`).
- API key & webhook secret in secret storage only; never logged, never committed.
- Webhook endpoint authenticated and rate-limited.
- The integration sends only blockchain addresses and tx hashes to the provider; no
  additional personal data. It stores only what is needed (addresses, tx hashes, scores).
- Data-residency / processing-agreement aspects are tracked separately in the internal
  compliance documentation (out of scope for this technical spec).

## 11. Rollout plan (two PRs)

1. **PR 1 — this specification** → review & approval (no code).
2. **PR 2 — full integration (single PR):** `ScorechainModule`, `ScorechainService`
   (API client + signature verify), `scorechain_screening` entity + migration, scoring,
   TMS (`registerDeposit`/`registerWithdrawal`), webhook receiver + alert ingestion, AML
   wiring, quota guard, monitoring/`/status`, reports, and the complete test suite (§13).

### 11.1 Definition of Done (implementation PR)

The implementation PR must satisfy the DFX engineering rules so the integration ships clean
and consistent — no untyped failures, no silent passes:

- Branch from `develop`; `feat/<scope>-<topic>`; squash-merge.
- `npm run format`, `npm run lint`, `npm run type-check`, `npm test` all green before push.
- Schema change ships with its TypeORM migration in the **same** PR; migrations immutable
  once merged.
- DTOs validated (`@IsEnum`, `@IsString`, Create vs. Update DTO conventions with
  `@IsOptionalButNotNull`); no unvalidated external input reaches business logic.
- **Fail-closed error handling**: every Scorechain call has explicit error handling and
  throws a typed Nest exception (cf. `IknaService` → `ServiceUnavailableException`); a
  provider/network/signature failure routes to manual review, it never silently lets a
  transaction pass. No swallowed promises, no `any`-typed responses.
- API key / webhook secret only from config/secret storage; never logged, never committed.
- Commits **signed**; PR opened as **Draft**.

## 12. Open questions (for reviewers)

1. **AML modelling:** reuse `AmlError.FORCE_MANUAL_CHECK` / `AmlReason.MANUAL_CHECK`, or add
   a dedicated Scorechain `AmlError` + `AmlReason` (both mapped to `CheckStatus.PENDING` for
   manual review)? Who owns the threshold config?
2. **TMS depth:** the synchronous gate is `scoringAnalysis`. Do we **also** run the async
   TMS workflow (`registerDeposit`/`registerWithdrawal` → scenarios/alerts) for the full
   rules engine + audit trail, or start with `scoringAnalysis` alone? (`register*` is a
   license-gated TMS feature — `NotIncludedInLicense`.)
3. **Signature verification:** adopt the Scorechain JS SDK, or implement RSA-SHA256
   verification with Node `crypto` (no new dependency)?
4. **Quota policy at limit:** fail-closed (→ manual review) vs. fail-open + alert? Spec
   recommends fail-closed.
5. **ikna coexistence:** any short-term routing rule (which chains/flows go to which
   provider), or run both fully in parallel and compare?
6. **Exact call-sites** — the deposit gate on the sell-crypto / buy-crypto-swap pay-in path,
   the withdrawal gate on the buy-crypto / payout path — confirm during review.
7. **Alert delivery:** inbound webhook (`ScenarioAlertCallback`) vs. scheduled polling of
   `/scenarios/alerts` — which is acceptable for our infra?

## 13. Testing (covers the complete surface)

- **Jest** unit tests (`npm test`, runs `--silent`) for `ScorechainService` with a mocked
  `HttpService`, covering: request shaping, signature verification (valid/invalid),
  blockchain mapping, quota guard, cache hit/miss. Tests live next to the code they cover.
- Tests for deposit/withdrawal screening → AML signal, and webhook/alert ingestion.
- No live API calls in CI; record fixtures from the sandbox/workspace.
- Before push: `npm run format`, `npm run lint`, `npm run type-check`, `npm test` green.

## 14. References

- Scorechain API docs: https://tech-doc.api.scorechain.com/ (OpenAPI `…/api.yaml`)
- Existing analog integration: `src/integration/ikna/`
- AML domain: `src/subdomains/core/aml/`
- Config pattern: `src/config/config.ts` (`ikna`, `tatum`, `sift` blocks)
- Contributing rules: `CONTRIBUTING.md`
