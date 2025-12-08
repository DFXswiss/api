# RealUnit Sell Flow

Diese Dokumentation beschreibt den vollständigen Ablauf für den Verkauf von REALU Tokens über die DFX API.

## Übersicht

Der Verkauf erfolgt in zwei atomaren Schritten:
1. **REALU → ZCHF**: Verkauf über den Brokerbot Smart Contract
2. **ZCHF → DFX**: Transfer via Permit2 Signatur an DFX

Beide Transaktionen werden vom Backend validiert und nur gemeinsam ausgeführt.

---

## Schritt 1: Transaktionsdaten abrufen

### Request

```http
POST /realunit/brokerbot/sell
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "shares": 10,
  "walletAddress": "0xABC123...",
  "minPrice": "1000.00"
}
```

| Feld | Typ | Pflicht | Beschreibung |
|------|-----|---------|--------------|
| `shares` | number | Ja | Anzahl REALU Shares zum Verkauf |
| `walletAddress` | string | Ja | Ethereum Wallet-Adresse des Verkäufers |
| `minPrice` | string | Nein | Minimaler Verkaufspreis (Slippage-Schutz) |

### Response

```json
{
  "brokerbotTx": {
    "to": "0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B",
    "data": "0x4000aea0000000000000000000000000cff32c60b87296b8c0c12980de685bed6cb9dd6d000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000",
    "value": "0",
    "gasLimit": "150000",
    "chainId": 1
  },
  "permit2": {
    "token": "0xB58E61C3098d85632Df34EecfB899A1Ed80921cB",
    "amount": "1050500000000000000000",
    "spender": "0xDFX_EXECUTOR_ADDRESS",
    "nonce": 0,
    "deadline": 1702050000
  },
  "expectedShares": 10,
  "expectedPrice": "1050.50",
  "expectedPriceRaw": "1050500000000000000000",
  "expiresAt": "2024-12-08T12:30:00.000Z"
}
```

### Response-Felder

#### `brokerbotTx` - Brokerbot Transaktionsdaten

| Feld | Beschreibung |
|------|--------------|
| `to` | REALU Token Contract Adresse |
| `data` | Encoded `transferAndCall()` Funktionsaufruf |
| `value` | ETH Wert (immer "0") |
| `gasLimit` | Geschätztes Gas Limit |
| `chainId` | Chain ID (1 = Ethereum Mainnet) |

#### `permit2` - Permit2 Signaturdaten

| Feld | Beschreibung |
|------|--------------|
| `token` | ZCHF Token Adresse |
| `amount` | ZCHF Betrag in Wei (entspricht `expectedPriceRaw`) |
| `spender` | DFX Executor Wallet (Empfänger der ZCHF) |
| `nonce` | Nächste freie Permit2 Nonce für diese Wallet |
| `deadline` | Unix Timestamp bis wann die Signatur gültig ist |

#### Weitere Felder

| Feld | Beschreibung |
|------|--------------|
| `expectedShares` | Anzahl verkaufter Shares |
| `expectedPrice` | Erwarteter ZCHF Erlös (formatiert) |
| `expectedPriceRaw` | Erwarteter ZCHF Erlös in Wei |
| `expiresAt` | Gültigkeit der Transaktionsdaten (ISO Timestamp) |

---

## Schritt 2: Signaturen erstellen (Client-seitig)

### A) Brokerbot Transaktion signieren

Die Brokerbot-Transaktion ist eine Standard Ethereum-Transaktion die mit dem Wallet signiert wird:

```javascript
// Ethers.js v5
const tx = {
  to: response.brokerbotTx.to,
  data: response.brokerbotTx.data,
  value: response.brokerbotTx.value,
  gasLimit: response.brokerbotTx.gasLimit,
  chainId: response.brokerbotTx.chainId,
  nonce: await provider.getTransactionCount(walletAddress),
  maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
  maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
  type: 2 // EIP-1559
};

const signedBrokerbotTx = await wallet.signTransaction(tx);
// Ergebnis: "0xf86c..."
```

### B) Permit2 EIP-712 Signatur erstellen

Die Permit2-Signatur ist eine typisierte EIP-712 Signatur:

```javascript
// Permit2 Contract Adresse (Uniswap)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// EIP-712 Domain
const domain = {
  name: "Permit2",
  chainId: 1,
  verifyingContract: PERMIT2_ADDRESS
};

// EIP-712 Types
const types = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" }
  ]
};

// Signatur-Nachricht aus API Response
const message = {
  permitted: {
    token: response.permit2.token,      // ZCHF Adresse
    amount: response.permit2.amount     // Betrag in Wei
  },
  spender: response.permit2.spender,    // DFX Executor
  nonce: response.permit2.nonce,        // Nonce von API
  deadline: response.permit2.deadline   // Deadline von API
};

// Signatur erstellen
const signature = await wallet._signTypedData(domain, types, message);
// Ergebnis: "0x1234..."
```

---

## Schritt 3: Atomic Sell ausführen

### Request

```http
POST /realunit/sell
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "signedBrokerbotTx": "0xf86c808504a817c80082520894553c7f9c780316fc1d34b8e14ac2465ab22a090b80b844...",
  "permit": {
    "signature": "0x1234567890abcdef...",
    "amount": "1050500000000000000000",
    "nonce": 0,
    "deadline": 1702050000
  }
}
```

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `signedBrokerbotTx` | string | Hex-encoded signierte Brokerbot Transaktion |
| `permit.signature` | string | EIP-712 Permit2 Signatur |
| `permit.amount` | string | ZCHF Betrag in Wei (muss mit Brokerbot Output übereinstimmen) |
| `permit.nonce` | number | Permit2 Nonce |
| `permit.deadline` | number | Permit2 Deadline (Unix Timestamp) |

### Response

```json
{
  "brokerbotTxHash": "0xabc123...",
  "permitTxHash": "0xdef456...",
  "shares": 10,
  "zchfReceived": "1050.50",
  "zchfTransferred": "1050.50"
}
```

| Feld | Beschreibung |
|------|--------------|
| `brokerbotTxHash` | Transaction Hash der Brokerbot TX (REALU → ZCHF) |
| `permitTxHash` | Transaction Hash der Permit2 TX (ZCHF → DFX) |
| `shares` | Anzahl verkaufter REALU Shares |
| `zchfReceived` | ZCHF vom Brokerbot erhalten |
| `zchfTransferred` | ZCHF an DFX transferiert |

---

## Validierungen

Das Backend führt folgende Validierungen durch bevor die Transaktionen ausgeführt werden:

1. **Brokerbot TX Validierung**
   - Ziel-Adresse ist REALU Token Contract
   - Methode ist `transferAndCall` zum Brokerbot
   - Signatur ist gültig

2. **Permit2 Validierung**
   - Betrag stimmt mit erwartetem Brokerbot Output überein
   - Deadline ist nicht abgelaufen
   - Nonce ist gültig (nicht bereits verwendet)

3. **Atomare Ausführung**
   - Brokerbot TX wird gesendet und auf Bestätigung gewartet
   - Nur bei Erfolg wird Permit2 Transfer ausgeführt
   - Bei Fehler in einem der Schritte wird abgebrochen

---

## Fehlerbehandlung

| Error Code | Beschreibung |
|------------|--------------|
| `WRONG_CONTRACT` | Brokerbot TX Ziel ist nicht REALU Token |
| `WRONG_METHOD` | TX Methode ist nicht transferAndCall |
| `AMOUNT_MISMATCH` | Permit2 Betrag stimmt nicht mit Brokerbot Output überein |
| `PERMIT_EXPIRED` | Permit2 Deadline ist abgelaufen |
| `PRICE_TOO_LOW` | Aktueller Preis unter minPrice |
| `BROADCAST_FAILED` | TX konnte nicht gesendet werden |

---

## Voraussetzungen

Bevor der Sell Flow genutzt werden kann:

1. **ZCHF Approval für Permit2**
   - Einmalig muss ZCHF für den Permit2 Contract approved werden
   - Endpoint: `POST /realunit/brokerbot/approve`
   - Status prüfen: `GET /realunit/brokerbot/approval/:address`

2. **Allowlist Status**
   - Wallet muss für REALU Transfers berechtigt sein
   - Status prüfen: `GET /realunit/allowlist/:address`

---

## Komplettes Beispiel (JavaScript)

```javascript
import { ethers } from 'ethers';

const API_BASE = 'https://api.dfx.swiss/v1';
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

async function sellRealUnit(wallet, jwt, shares) {
  // 1. Transaktionsdaten abrufen
  const prepareResponse = await fetch(`${API_BASE}/realunit/brokerbot/sell`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      shares: shares,
      walletAddress: wallet.address
    })
  });

  const data = await prepareResponse.json();

  // 2a. Brokerbot TX signieren
  const provider = wallet.provider;
  const tx = {
    to: data.brokerbotTx.to,
    data: data.brokerbotTx.data,
    value: data.brokerbotTx.value,
    gasLimit: data.brokerbotTx.gasLimit,
    chainId: data.brokerbotTx.chainId,
    nonce: await provider.getTransactionCount(wallet.address),
    maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
    maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei'),
    type: 2
  };

  const signedBrokerbotTx = await wallet.signTransaction(tx);

  // 2b. Permit2 Signatur erstellen
  const domain = {
    name: 'Permit2',
    chainId: 1,
    verifyingContract: PERMIT2_ADDRESS
  };

  const types = {
    PermitTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ],
    TokenPermissions: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ]
  };

  const message = {
    permitted: {
      token: data.permit2.token,
      amount: data.permit2.amount
    },
    spender: data.permit2.spender,
    nonce: data.permit2.nonce,
    deadline: data.permit2.deadline
  };

  const signature = await wallet._signTypedData(domain, types, message);

  // 3. Atomic Sell ausführen
  const sellResponse = await fetch(`${API_BASE}/realunit/sell`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      signedBrokerbotTx: signedBrokerbotTx,
      permit: {
        signature: signature,
        amount: data.permit2.amount,
        nonce: data.permit2.nonce,
        deadline: data.permit2.deadline
      }
    })
  });

  return sellResponse.json();
}

// Verwendung
const result = await sellRealUnit(wallet, jwtToken, 10);
console.log('Verkauf abgeschlossen:', result);
```
