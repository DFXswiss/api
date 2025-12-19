# Alchemy SDK Migration Plan

## Hintergrund

Das `alchemy-sdk` NPM Package wird **eingestellt** und im **Januar 2026 archiviert**. Bis dahin gibt es nur noch minimalen Support.

Quelle: https://github.com/alchemyplatform/alchemy-sdk-js

## Warum ist diese Umstellung notwendig?

1. **Keine Updates mehr**: Das bestehende SDK erhält keine neuen Features oder Bugfixes
2. **Keine neuen Blockchains**: Neue Chains werden nicht mehr zum SDK hinzugefügt - wir können keine weiteren Blockchains einbauen
3. **Sicherheitsrisiko**: Nach Januar 2026 werden auch keine Security-Patches mehr veröffentlicht
4. **Dependency-Risiko**: Das SDK basiert auf älteren Versionen von ethers.js die ebenfalls veralten

## Aktuelle Nutzung

### AlchemyService (`src/integration/alchemy/services/alchemy.service.ts`)

| Feature | Methode | Ersatz |
|---------|---------|--------|
| Native Coin Balance | `alchemy.core.getBalance()` | Viem |
| Token Balances | `alchemy.core.getTokenBalances()` | Viem |
| Contract Call | `alchemy.core.call()` | Viem |
| Block Info | `alchemy.core.getBlock()` | Viem |
| Block Number | `alchemy.core.getBlockNumber()` | Viem |
| Send Transaction | `alchemy.transact.sendTransaction()` | Viem |
| Get Transaction | `alchemy.transact.getTransaction()` | Viem |
| **Asset Transfers** | `alchemy.core.getAssetTransfers()` | Portfolio REST API |

### AlchemyWebhookService (`src/integration/alchemy/services/alchemy-webhook.service.ts`)

| Feature | Methode | Ersatz |
|---------|---------|--------|
| Get Webhooks | `alchemy.notify.getAllWebhooks()` | Notify REST API |
| Create Webhook | `alchemy.notify.createWebhook()` | Notify REST API |
| Delete Webhook | `alchemy.notify.deleteWebhook()` | Notify REST API |
| Update Webhook | `alchemy.notify.updateWebhook()` | Notify REST API |
| Get Addresses | `alchemy.notify.getAddresses()` | Notify REST API |

### AlchemyNetworkMapper (`src/integration/alchemy/alchemy-network-mapper.ts`)

- Network Enum Mapping → Viem Chain IDs

## Migrations-Strategie

```
alchemy-sdk (deprecated)
         │
         ▼
    ┌────┴────┐
    │         │
  Viem    REST APIs
    │         │
    ├─────────┼─── Portfolio API (getAssetTransfers)
    │         └─── Notify API (Webhooks)
    │
    └─── RPC Calls (getBalance, getBlock, sendTransaction, etc.)
```

### 1. Viem für Standard RPC Calls

Viem ist eine moderne TypeScript Library für Ethereum-Interaktionen:
- https://viem.sh/
- https://github.com/wevm/viem

Vorteile:
- Aktiv maintained (95k+ Projekte nutzen es)
- TypeScript-first mit besserer Type Safety
- Native BigInt Support (kein BigNumber Library nötig)
- Wird von Alchemy selbst empfohlen

### 2. Portfolio REST API für Asset Transfers

Dokumentation: https://www.alchemy.com/docs/reference/portfolio-apis

Endpoints:
- `getTokensByWallet` - Token Balances
- `getTransactionsByWallet` - Transaction History (ersetzt getAssetTransfers)

### 3. Notify REST API für Webhooks

Dokumentation: https://www.alchemy.com/docs/reference/notify-api-quickstart

Endpoints:
- `POST /api/create-webhook` - Webhook erstellen
- `DELETE /api/delete-webhook` - Webhook löschen
- `PATCH /api/update-webhook` - Webhook aktualisieren
- `GET /api/team-webhooks` - Alle Webhooks abrufen

## Betroffene Dateien

| Datei | Änderungsumfang |
|-------|-----------------|
| `src/integration/alchemy/services/alchemy.service.ts` | Gross |
| `src/integration/alchemy/services/alchemy-webhook.service.ts` | Gross |
| `src/integration/alchemy/alchemy-network-mapper.ts` | Klein |
| `src/integration/alchemy/dto/*.ts` | Mittel |
| `src/integration/blockchain/shared/evm/evm-client.ts` | Klein |
| `src/subdomains/supporting/payin/strategies/register/impl/*.ts` | Klein |
| `package.json` | Klein |

## Risikobewertung

**Niedrig** - weil:
- Keine Logik-Änderungen, nur SDK-Wechsel
- APIs bleiben inhaltlich gleich, nur der Aufruf ändert sich
- Genug Zeit für ausführliches Testing vor der Deadline

## Geschätzter Aufwand

- Entwicklung: 2-3 Tage
- Testing: 1-2 Tage
- Code Review: 1 Tag

## Deadline

**Januar 2026** - Das SDK wird archiviert und erhält keinen Support mehr.

## Empfehlung

Migration zeitnah planen und umsetzen, um:
1. Neue Blockchains integrieren zu können
2. Von Security Updates zu profitieren
3. Nicht unter Zeitdruck vor der Deadline migrieren zu müssen
