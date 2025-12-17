# Debugging Ideas - Aktionariat "Invalid Signature"

## Bereits verifiziert
- [x] Domain: `{ name: 'RealUnitUser', version: '1' }` - korrekt
- [x] Types: 13 Felder in exakter Reihenfolge - korrekt
- [x] Lokale Signatur-Verifizierung funktioniert
- [x] Extra Felder im Message-Objekt beeinflussen Hash nicht
- [x] Feld-Reihenfolge im Message-Objekt beeinflussen Hash nicht
- [x] Address-Case (checksum vs lowercase) beeinflussen Hash nicht

## Getestet am 2025-12-17 - ALLE FEHLGESCHLAGEN

### Signature-Variationen (test-aktionariat-variations.ts)
- [x] Standard Signatur -> Invalid signature
- [x] Lowercase walletAddress im Payload -> Invalid signature
- [x] Signatur ohne 0x Prefix -> Invalid signature
- [x] Signatur mit v=0/1 statt 27/28 -> Invalid signature
- [x] Mit countryAndTINs: [] -> Invalid signature
- [x] Mit countryAndTINs: null -> Invalid signature
- [x] Mit lowercase address signiert -> Invalid signature
- [x] Aktionariat Beispiel-Format -> Invalid signature
- [x] Compact Signature (64 bytes) -> 500 Error (zu kurz)

### Domain-Variationen (test-aktionariat-domain-variations.ts)
- [x] Standard (name + version) -> Invalid signature
- [x] Mit chainId=1 (Mainnet) -> Invalid signature
- [x] Mit chainId=137 (Polygon) -> Invalid signature
- [x] Mit chainId=10 (Optimism) -> Invalid signature
- [x] Mit chainId=42161 (Arbitrum) -> Invalid signature
- [x] Mit verifyingContract=0x0 -> Invalid signature
- [x] Name lowercase -> Invalid signature
- [x] Name: RealUnit -> Invalid signature

---

## Noch zu testen

### 1. Wallet Address Format
```typescript
// Vielleicht erwartet Aktionariat lowercase?
walletAddress: wallet.address.toLowerCase()
```

### 2. Signature v-Wert Format
```typescript
// Standard: v = 27 oder 28
// Alternative: v = 0 oder 1
// Manche Systeme erwarten 0/1 statt 27/28
```

### 3. Compact Signature Format
```typescript
// Volle Signatur: 65 bytes (r + s + v)
// Compact: 64 bytes (r + s mit recovery bit in s)
import { splitSignature, joinSignature } from 'ethers/lib/utils';
const split = splitSignature(signature);
const compact = split.compact; // 64 bytes
```

### 4. Aktionariat's Beispiel-Daten verwenden
```typescript
// Exakt die Daten aus Murat's E-Mail verwenden:
const message = {
  email: "example@aktionariat.com",
  name: "Murat Ögat",  // Mit Umlaut!
  type: "HUMAN",
  phoneNumber: "+41791234567",
  birthday: "1990-01-01",
  nationality: "CH",
  addressStreet: "Bahnhofstrasse 1",
  addressPostalCode: "8001",
  addressCity: "Zürich",  // Mit Umlaut!
  addressCountry: "CH",
  swissTaxResidence: true,
  registrationDate: "2025-12-01",
  walletAddress: "..."
};
```

### 5. Boolean als String
```typescript
// Vielleicht parsen sie den Boolean falsch?
swissTaxResidence: "true"  // statt true
```

### 6. countryAndTINs explizit senden
```typescript
// Vielleicht erwarten sie das Feld explizit?
countryAndTINs: []  // leeres Array
// oder
countryAndTINs: null
```

### 7. Domain mit chainId/verifyingContract
```typescript
// Vielleicht haben sie doch chainId im Code?
const domain = {
  name: 'RealUnitUser',
  version: '1',
  chainId: 1,  // Mainnet
};
```

### 8. EIP712Domain explizit in Types
```typescript
// Manche Implementierungen brauchen das
const types = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ],
  RealUnitUserRegistration: [...]
};
```

### 9. Ethers v6 direkt testen
```bash
# Separates Projekt mit ethers v6 erstellen
npm init -y
npm install ethers@6
```

### 10. Raw HTTP Request prüfen
```typescript
// Vielleicht Header-Problem?
headers: {
  'Content-Type': 'application/json',
  'x-api-key': '...',
  'Accept': 'application/json',  // Hinzufügen?
}
```

### 11. Signature ohne 0x Prefix
```typescript
signature: signature.slice(2)  // Ohne 0x
```

### 12. JSON Encoding prüfen
```typescript
// Prüfen ob JSON.stringify etwas verändert
console.log(JSON.stringify(payload));
// Besonders bei Umlauten oder Sonderzeichen
```

---

## Schnell-Tests zum Ausprobieren

```bash
# Test 1: Lowercase address
npx ts-node -e "
const { Wallet } = require('ethers');
const wallet = Wallet.fromMnemonic('cabin dizzy cage drastic damp surge meadow example spatial already quiz walnut');
console.log('Checksum:', wallet.address);
console.log('Lowercase:', wallet.address.toLowerCase());
"

# Test 2: Signature components
npx ts-node scripts/test-signature-recovery.ts

# Test 3: Mit Aktionariat Beispiel-Daten
# -> Neues Script erstellen
```

---

## Wahrscheinlichste Ursachen

1. **Bug bei Aktionariat** - Sie verifizieren den Hash anders als sie ihn dokumentiert haben
2. ~~**chainId/verifyingContract** - Sie haben vielleicht doch eins davon im Code~~ (getestet, nicht das Problem)
3. **Encoding-Unterschied** - Unterschiedliche UTF-8 Behandlung bei Strings
4. **Ethers Version** - Subtiler Unterschied zwischen v5 und v6
5. **Backend noch nicht vollständig deployed** - Endpoint existiert, aber Verifizierung ist buggy

---

## Fazit

**Alle vernünftigen Variationen wurden getestet und scheitern.**

Der nächste Schritt ist die direkte Zusammenarbeit mit Aktionariat:
1. E-Mail an Murat mit Test-Daten senden (siehe `email-aktionariat-signature-debug.md`)
2. Aktionariat bitten, dieselben Daten zu signieren
3. Intermediate Hashes vergleichen
4. Bug auf ihrer Seite identifizieren lassen
