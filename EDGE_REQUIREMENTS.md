# Edge Exchange Provider API Requirements - Tracking

## Status-Legende
- [ ] Nicht begonnen
- [~] In Arbeit
- [x] Erledigt

---

## Allgemeine Anforderungen (Swap + On/Off Ramp)

### 1. Chain and Token Identification `[~]` ~70%
**Anforderung:** Quotes/Orders via `chainNetwork` + `tokenId` (Contract Address). Für EVM-Chains zusätzlich `chainNetwork: "evmGeneric"` + `chainId`.

**Ist-Zustand:**
- Asset-Entity hat `chainId` (Contract Address) und `blockchain` Enum
- EVM Chain-Config mit numerischen chainIds vorhanden (ETH=1, BSC=56, etc.)
- `evmChainId` Feld in `AssetInDto` (numerische EVM Chain ID)
- `EvmUtil.getBlockchain()` Reverse-Lookup (chainId → Blockchain)
- `resolveAsset()` unterstützt `evmChainId` + `chainId` Kombination

**Offen:**
- [ ] Support für `chainNetwork` als String-Identifier (Edge-Format)
- [ ] Mapping zwischen Edge chain identifiers und DFX Blockchain-Enum

---

### 2. Order Identification and Status Page `[~]` ~70%
**Anforderung:** Unique `orderId` pro Order, abfragbar via unauthenticated API. Status-Page URL: `https://status.provider.com/orderStatus/{orderId}`

**Ist-Zustand:**
- TransactionRequest hat `uid` als unique identifier
- `GET /transaction/single?uid=...` existiert (unauthenticated)

**Offen:**
- [ ] Konsistentes `orderId` Feld in allen Responses
- [ ] Status-Page URL bereitstellen (Frontend oder Redirect)
- [ ] Path-Parameter statt Query-Parameter: `GET /api/status/{orderId}`

---

### 3. Error Handling `[~]` ~80%
**Anforderung:** Alle möglichen Fehler gleichzeitig zurückgeben. Hardened error codes: `RegionRestricted`, `AssetUnsupported`, `OverLimitError` (mit min/max in Source UND Destination Asset).

**Ist-Zustand:**
- QuoteError Enum: `AmountTooLow`, `AmountTooHigh`, `KycRequired`, `LimitExceeded`, `NationalityNotAllowed`, `PaymentMethodNotAllowed`, `RegionRestricted`, `AssetUnsupported`
- `minVolume`/`maxVolume` + `minVolumeTarget`/`maxVolumeTarget` in Quote-Response
- `errors` Array in allen Quote-DTOs (Buy/Sell/Swap) mit `StructuredErrorDto`
- `QuoteErrorUtil.mapToStructuredErrors()` mappt bestehende Errors auf Edge-Format
- Error-Mapping: `NationalityNotAllowed` → `RegionRestricted`, Amount-Errors → `OverLimitError`/`UnderLimitError` mit `sourceAmountLimit`/`destinationAmountLimit`

**Offen:**
- [ ] Alle Fehler gleichzeitig als Array zurückgeben (aktuell: einzelner Error → Array mit einem Element)

---

### 4. Quoting Requirements `[x]` 100%
**Anforderung:** Bi-directional quoting (Source ODER Destination Amount).

**Ist-Zustand:**
- XOR-Validation in `GetSwapQuoteDto`: `amount` oder `targetAmount`
- Gleiche Logik in Sell-Quotes
- **Vollständig erfüllt.**

---

### 5. Transaction Status API `[x]` 100%
**Anforderung:** `GET /api/status/{orderId}` mit Status: `pending | processing | infoNeeded | expired | refunded | completed`

**Ist-Zustand:**
- `GET /transaction/single` existiert (unauthenticated)
- TransactionState hat 14 verschiedene States
- `GET /transaction/status/:orderId` Endpoint (unauthenticated)
- `ProviderTransactionStatus` Enum mit Edge-Format
- `mapToProviderStatus()` mappt alle 14 States auf 6 Edge-Status-Werte
- Lookup via `uid` und `orderUid`

**Erledigt.**

---

### 6. Reporting API `[~]` ~40%
**Anforderung:** Authentifizierte API für alle Transaktionen. Pagination (start date, end date, count). Felder: orderId, status, dates, source/dest network/token/amount, payin/payout addresses, txids, EVM chainIds.

**Ist-Zustand:**
- `GET /history/:exportType` mit API-Key Auth
- `GET /transaction/detail` mit Bearer Token
- Date-Filter vorhanden

**Offen:**
- [ ] Explizite Pagination (startDate, endDate, limit/offset)
- [ ] Response-Format mit allen Edge-Pflichtfeldern
- [ ] `orderId` konsistent (statt `id`/`uid`)
- [ ] EVM `chainId` im Response
- [ ] Source/Dest Network + TokenId + Amount + Addresses + Txids

---

### 7. Account Activation `[ ]` 0%
**Anforderung:** Bei XRP/HBAR: unactivated Addresses erkennen und Aktivierungs-Transaktion senden.

**Ist-Zustand:**
- XRP und HBAR sind nicht in der Blockchain-Enum

**Offen:**
- [ ] Prüfen ob XRP/HBAR überhaupt unterstützt werden sollen
- [ ] Falls ja: Activation-Logik implementieren

---

### 8. Affiliate Revenue Withdrawal `[ ]` ~10%
**Anforderung:** Auto-Withdraw innerhalb 24h nach Monatsende. In BTC/ETH/USDC an feste, verifizierte Adresse.

**Ist-Zustand:**
- Referral/RefReward System vorhanden

**Offen:**
- [ ] Klären ob DFX Affiliate-Programm mit Edge hat
- [ ] Auto-Withdrawal Mechanismus (Cron-Job)
- [ ] Fixed address Verwaltung mit 2FA/Email-Verification bei Änderung

---

## Zusätzliche Anforderungen für Fiat On/Off Ramp

### 9. User Authentication `[~]` ~60%
**Anforderung:** Auth via cryptographic random `authKey`. Auto-Account-Erstellung wenn authKey nicht existiert. KYC-Info via API.

**Ist-Zustand:**
- Wallet-Signature basierte Auth (`POST /auth`)
- Auto-Signup bei `POST /auth/signUp`

**Offen:**
- [ ] `authKey`-basierte Authentifizierung (random key statt wallet signature)
- [ ] Auto-Create Account bei unbekanntem authKey
- [ ] authKey in Quote/Order-Endpoints akzeptieren

---

### 10. Regional and Fiat Currency Support `[~]` ~40%
**Anforderung:** Quote-Request mit Region (Country/Province) und Fiat-Currency. Proper Errors bei unsupported.

**Ist-Zustand:**
- IP-basierte Country-Detection
- Fiat-Currency Support in Quotes

**Offen:**
- [ ] Expliziter `region`/`country` Parameter in Quote-Requests
- [ ] Expliziter `fiatCurrency` Parameter
- [ ] Spezifische Errors: `RegionNotSupported`, `CurrencyNotSupported`

---

### 11. KYC Information `[~]` ~60%
**Anforderung:** KYC-Daten (Name, Address, Phone, Email) via API submitten (kein Widget).

**Ist-Zustand:**
- UserData-Update mit firstname, surname, street, phone, mail etc.
- KYC-Controller vorhanden

**Offen:**
- [ ] Dedizierter KYC-Submission-Endpoint für Edge
- [ ] Sicherstellen dass alle Felder via API setzbar sind (ohne Widget)

---

### 12. Bank Information `[~]` ~40%
**Anforderung:** Bank-Info (Account Number, IBAN, Routing Number) via API submitten.

**Ist-Zustand:**
- BankData-Controller existiert (Admin-only)
- CreateBankDataDto: IBAN, BIC, Name

**Offen:**
- [ ] User-zugängliche API (nicht nur Admin)
- [ ] `accountNumber` und `routingNumber` Felder (für US-Markt)

---

### 13. Verification `[ ]` ~10%
**Anforderung:** KYC-Verification-Codes (Phone/Email) über API senden. Edge informieren wenn KYC-Info fehlt/veraltet.

**Ist-Zustand:**
- KYC via externen Provider (SumSub)

**Offen:**
- [ ] Phone-Verification-Code senden via API
- [ ] Email-Verification-Code senden via API
- [ ] Verification-Code validieren via API
- [ ] "KYC info missing/outdated" Status in API-Response

---

### 14. Widgets `[~]` ~30%
**Anforderung:** Widgets müssen Return-URIs unterstützen, damit Edge Webviews schließen kann.

**Ist-Zustand:**
- Redirect-Logik in Auth vorhanden

**Offen:**
- [ ] Return-URI Parameter für alle Widget-Flows
- [ ] Callback nach Widget-Completion

---

### 15. Off-Ramp Flow `[~]` ~50%
**Anforderung:** No-Widget Off-Ramp: Crypto-Address + Expiration-Time bereitstellen.

**Ist-Zustand:**
- Sell-Flow mit Deposit-Address vorhanden

**Offen:**
- [ ] Expiration-Time für Deposit-Addresses
- [ ] Sicherstellen dass Flow komplett ohne Widget funktioniert
