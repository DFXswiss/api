# PR #2336 - CitreaTestnet Integration
## Review Comments von davidleomay

**PR:** [#2336 - add Citrea Testnet](https://github.com/DFXswiss/api/pull/2336)  
**Reviewer:** davidleomay  
**Branch:** citrea_test → develop  
**Status:** OPEN  

---

## 📅 Chronologische Übersicht aller Kommentare

### 11. August 2025 (Erste Review-Runde)

#### 14:08:20 - `src/integration/blockchain/shared/evm/evm-client.ts`
**Kommentar:** "Is there a type for this service?"
**Kontext:** Fehlende TypeScript-Typdefinition für GoldskyService

#### 14:11:38 - `src/subdomains/supporting/payout/strategies/prepare/impl/citrea-testnet.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** getFeeAsset() Methode nicht implementiert

#### 14:12:04 - `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-token.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** getCurrentGasForTransaction() hardcoded

#### 14:12:09 - `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-token.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** getFeeAsset() Methode nicht implementiert

#### 14:12:18 - `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-coin.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** getCurrentGasForTransaction() hardcoded

#### 14:12:27 - `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-coin.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** getFeeAsset() Methode nicht implementiert

#### 14:13:24 - `src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-token.strategy.ts`
**Kommentar:** "`citreaTestnet` cannot be null"
**Kontext:** Null-Safety Problem in getForwardAddress()

#### 14:13:38 - `src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-coin.strategy.ts`
**Kommentar:** "Same here"
**Kontext:** Null-Safety Problem in getForwardAddress()

#### 14:14:09 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts`
**Kommentar:** "TODO"
**Kontext:** Unvollständige Implementierung

#### 14:14:26 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts`
**Kommentar:** "`citreaTestnet` cannot be null"
**Kontext:** Null-Safety Problem

#### 14:15:07 - `src/integration/blockchain/shared/evm/evm.util.ts`
**Kommentar:** "`citreaTestnet` cannot be null"
**Kontext:** Null-Safety Problem

#### 14:16:53 - `src/integration/goldsky/goldsky.service.ts`
**Kommentar:** "`citreaTestnet` cannot be null"
**Kontext:** Null-Safety Problem in getEndpoints()

#### 14:17:01 - `src/integration/goldsky/goldsky.service.ts`
**Kommentar:** "Weird coding"
**Kontext:** Code-Stil Problem

#### 14:17:34 - `src/integration/blockchain/citrea-testnet/citrea-testnet-client.ts`
**Kommentar:** "Throw an error, if no goldsky"
**Kontext:** Fehlende Error-Behandlung für Goldsky Service

#### 14:17:52 - `src/integration/goldsky/goldsky.service.ts`
**Kommentar:** "Throw an error, if no matching endpoint"
**Kontext:** Fehlende Error-Behandlung

#### 14:18:15 - `src/integration/goldsky/goldsky.service.ts`
**Kommentar:** "Same here"
**Kontext:** Fehlende Error-Behandlung

#### 14:18:32 - Review Summary
**Kommentar:** "- [ ] DEX strategies are missing"
**Kontext:** Hauptproblem - DEX-Strategien fehlen komplett

---

### 12. August 2025 (Zweite Review-Runde) - INNERHALB DER LETZTEN 20 STUNDEN

#### 21:06:57 - `migration/1754950663000-citrea-testnet-cbtc-asset.seed.ts:1`
**Kommentar:** "We do not use seed migrations"
**Aktion erforderlich:** Migration umbenennen/umstrukturieren

#### 21:07:42 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:247`
**Kommentar:** "Linter warning"
**Aktion erforderlich:** Linter-Fehler beheben

#### 21:07:56 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:12`
**Kommentar:** "Linter warning"
**Aktion erforderlich:** Linter-Fehler beheben

#### 21:09:05 - `src/subdomains/supporting/payin/payin.module.ts:1`
**Kommentar:** "DEX strategies are still missing"
**Aktion erforderlich:** DEX-Strategien hinzufügen

#### 21:09:56 - `src/subdomains/supporting/payout/payout.module.ts:139`
**Kommentar:** "What?"
**Aktion erforderlich:** Unklaren Code überprüfen/klären

#### 21:17:53 - `src/integration/goldsky/goldsky.service.ts:32`
**Kommentar:** "Create an enum for these networks, use pascal case for enum values"
**Aktion erforderlich:** Enum für Networks erstellen mit PascalCase

#### 21:21:42 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:59`
**Kommentar:** "This is done by `@DfxCron`"
**Aktion erforderlich:** Redundanten Code entfernen

#### 21:25:25 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:335`
**Kommentar:** "`return [Config.blockchain.citreaTestnet.citreaTestnetWalletAddress, Config.payment.citreaTestnetAddress];`"
**Aktion erforderlich:** Code vereinfachen wie vorgeschlagen

#### 21:26:13 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:218`
**Kommentar:** "Who in the world would create a fallback for this?"
**Aktion erforderlich:** Unnötigen Fallback entfernen

#### 22:07:28 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:124`
**Kommentar:** "Error logging is done in @DfxCron"
**Aktion erforderlich:** Redundantes Error-Logging entfernen

#### 22:08:09 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:183`
**Kommentar:** "Doesn't make sense to catch the error"
**Aktion erforderlich:** Unnötigen try-catch entfernen

#### 22:27:58 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:1`
**Kommentar:** "Does it have to be so complicated? 😆"
**Aktion erforderlich:** Code-Komplexität reduzieren

#### 22:29:20 - `src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts:24`
**Kommentar:** "We use camel case for setting keys"
**Aktion erforderlich:** Setting-Keys zu camelCase ändern

---

## 📊 Zusammenfassung

### Statistik
- **Gesamt-Kommentare:** 29
- **Erste Review (11.08.):** 16 Kommentare
- **Zweite Review (12.08.):** 13 Kommentare (innerhalb der letzten 20 Stunden)

### Hauptprobleme nach Priorität

#### 🔴 Kritisch (Muss behoben werden)
1. **DEX-Strategien fehlen komplett** (2x erwähnt)
2. **Seed-Migration nicht erlaubt** - Umbenennung erforderlich
3. **Linter-Warnungen** (2x) - Build könnte fehlschlagen

#### 🟡 Wichtig (Sollte behoben werden)
1. **Null-Safety Issues** (6x erwähnt) - bereits teilweise adressiert
2. **TypeScript-Typdefinitionen fehlen** - bereits adressiert
3. **Error-Handling verbessern** (3x erwähnt)
4. **Code-Stil** (camelCase für Settings, Enum für Networks)

#### 🟢 Nice-to-have (Code-Qualität)
1. **Code-Komplexität reduzieren**
2. **Redundanten Code entfernen** (@DfxCron, Error-Logging)
3. **Unnötige Fallbacks entfernen**

### Dateien mit den meisten Kommentaren
1. `citrea-testnet.strategy.ts` - 11 Kommentare
2. `goldsky.service.ts` - 5 Kommentare
3. `citrea-testnet-token.strategy.ts` - 2 Kommentare
4. `citrea-testnet-coin.strategy.ts` - 3 Kommentare

### Status der Behebung
- ✅ **Bereits behoben (11.08.):** 16 Kommentare in Commit `707c1befa`
- ❌ **Noch offen (12.08.):** 13 neue Kommentare
- ⏳ **Zu bearbeiten:** DEX-Strategien, Migration, Linter, Code-Stil

---

## 🔧 Nächste Schritte

1. **Sofort beheben:**
   - [ ] DEX-Strategien implementieren
   - [ ] Seed-Migration umbenennen/umstrukturieren
   - [ ] Linter-Warnungen beheben

2. **Anschließend:**
   - [ ] Enum für Goldsky Networks erstellen
   - [ ] Setting-Keys zu camelCase ändern
   - [ ] Redundanten Code entfernen

3. **Code-Review:**
   - [ ] Komplexität in citrea-testnet.strategy.ts reduzieren
   - [ ] Unnötige try-catch und Fallbacks entfernen
   - [ ] Code vereinfachen wo möglich

---

*Dokument erstellt: 13.08.2025*  
*PR: https://github.com/DFXswiss/api/pull/2336*