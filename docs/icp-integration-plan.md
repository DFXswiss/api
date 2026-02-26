# ICP Blockchain Integration Plan

## Overview

This document outlines the technical implementation plan for integrating the Internet Computer Protocol (ICP) blockchain into the DFX payment infrastructure, as per the contract with DFINITY Stiftung (signed January 2026).

### Tokens in Scope

| Token | Type | Canister ID | Status |
|-------|------|-------------|--------|
| ICP | Native Coin | `ryjl3-tyaaa-aaaaa-aaaba-cai` | Ready |
| ckBTC | Chain-Key Token | `mxzaz-hqaaa-aaaar-qaada-cai` | Ready |
| ckUSDC | Chain-Key Token | `xevnm-gaaaa-aaaar-qafnq-cai` | Ready |
| ckUSDT | Chain-Key Token | `cngnf-vqaaa-aaaar-qag4q-cai` | Ready |
| VCHF | ICRC-1 Token | TBD | Pending VNX deployment |
| VEUR | ICRC-1 Token | TBD | Pending VNX deployment |

---

## 1. Architecture Overview

### 1.1 ICP Technical Characteristics

| Aspect | ICP Implementation |
|--------|-------------------|
| RPC Provider | **Not needed** - public API boundary nodes |
| API Endpoint | `https://icp-api.io` or `https://icp0.io` |
| Protocol | **Candid** (Interface Description Language) |
| Address Format | **Principal ID** + optional **Subaccount** (32 bytes) |
| Legacy Address | **Account Identifier** (64-char hex, for ICP native) |
| Token Standard | **ICRC-1 / ICRC-2** |
| Deposit Detection | **Polling** via Index Canister |
| Transaction Finality | **~2 seconds** |
| Gas Model | **Cycles** (prepaid by canister, not by user) |

### 1.2 ICP Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DFX API Backend                          │
│                     (NestJS Application)                        │
└──────────────┬──────────────────────────────────┬───────────────┘
               │                                  │
               │ Polling (Cron)                   │ Canister Calls
               │ (Deposit detection               │ (Payouts, sweeps)
               │  every 10 seconds)               │
               ▼                                  ▼
┌──────────────────────────────┐    ┌─────────────────────────────────┐
│    IcpDepositService         │    │        IcpClientService         │
│    (Polling-based detection) │    │    (@dfinity/agent + ledger)    │
└──────────────┬───────────────┘    └────────────────┬────────────────┘
               │                                     │
               ▼                                     ▼
┌──────────────────────────────┐    ┌─────────────────────────────────┐
│   ICP Index Canister         │    │      Token Ledger Canisters     │
│   (Official DFINITY)         │    │                                 │
│   qhbym-qaaaa-aaaaa-aaafq-cai│    │  ICP, ckBTC, ckUSDC, ckUSDT    │
│                              │    │                                 │
│   Features:                  │    │  Features:                      │
│   - Account-based queries    │    │  - ICRC-1 transfers             │
│   - Transaction history      │    │  - Balance queries              │
│   - Block sync status        │    │  - Token metadata               │
└──────────────────────────────┘    └─────────────────────────────────┘
```

### 1.3 Official Canister IDs

| Component | Canister ID | Maintainer | Notes |
|-----------|-------------|------------|-------|
| **ICP Index** | `qhbym-qaaaa-aaaaa-aaafq-cai` | DFINITY | Account transaction queries |
| **ICP Ledger** | `ryjl3-tyaaa-aaaaa-aaaba-cai` | DFINITY | Native ICP token |
| **ckBTC Ledger** | `mxzaz-hqaaa-aaaar-qaada-cai` | DFINITY | Chain-key Bitcoin |
| **ckBTC Index** | `n5wcd-faaaa-aaaar-qaaea-cai` | DFINITY | ckBTC transactions |
| **ckBTC Minter** | `mqygn-kiaaa-aaaar-qaadq-cai` | DFINITY | BTC ↔ ckBTC |
| **ckUSDC Ledger** | `xevnm-gaaaa-aaaar-qafnq-cai` | DFINITY | Chain-key USDC |
| **ckUSDT Ledger** | `cngnf-vqaaa-aaaar-qag4q-cai` | DFINITY | Chain-key USDT |
| **VCHF Ledger** | **TBD** | VNX | Pending deployment |
| **VEUR Ledger** | **TBD** | VNX | Pending deployment |

---

## 2. Required Dependencies

### 2.1 NPM Packages

```bash
# Core ICP Agent
npm install @dfinity/agent @dfinity/principal @dfinity/candid

# Identity Management (for wallet/signing)
npm install @dfinity/identity-secp256k1

# ICRC-1/2 Token Interaction (includes ICP ledger)
npm install @dfinity/ledger-icrc @dfinity/ledger-icp

# Specific for ckBTC (minting/burning from real BTC)
npm install @dfinity/ckbtc

# Utilities
npm install @dfinity/utils
```

### 2.2 TypeScript Configuration

The `@dfinity/*` packages require `moduleResolution: "node16"` or later in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "moduleResolution": "node16"
  }
}
```

---

## 3. Implementation Components

### 3.1 New Files to Create

```
src/
├── integration/
│   └── blockchain/
│       └── icp/
│           ├── icp.module.ts
│           ├── services/
│           │   ├── icp-client.service.ts          # Main ICP client
│           │   ├── icp-deposit.service.ts         # Polling-based deposit detection
│           │   ├── icrc-ledger.service.ts         # Generic ICRC-1/2 tokens
│           │   ├── ckbtc.service.ts               # ckBTC operations
│           │   └── icp-address.service.ts         # Address generation
│           ├── dto/
│           │   ├── icp-transfer.dto.ts
│           │   └── icp-account.dto.ts
│           └── __tests__/
│               ├── icp-client.service.spec.ts
│               └── icp-deposit.service.spec.ts
│
├── subdomains/
│   └── supporting/
│       ├── payin/
│       │   └── strategies/
│       │       └── register/
│       │           └── impl/
│       │               └── icp.strategy.ts        # Polling-based PayIn
│       └── payout/
│           └── strategies/
│               └── payout/
│                   └── impl/
│                       └── icp.strategy.ts        # Payout execution
```

### 3.2 Enum Updates

**File:** `src/shared/enums/blockchain.enum.ts`

```typescript
export enum Blockchain {
  // ... existing blockchains

  // New ICP blockchain
  InternetComputer = 'InternetComputer',
}
```

---

## 4. Core Service Implementations

### 4.1 ICP Client Service

**File:** `src/integration/blockchain/icp/services/icp-client.service.ts`

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAgent } from '@dfinity/agent';
import { Secp256k1KeyIdentity } from '@dfinity/identity-secp256k1';
import { Principal } from '@dfinity/principal';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { Config } from 'src/config/config';

@Injectable()
export class IcpClientService implements OnModuleInit {
  private agent: HttpAgent;
  private identity: Secp256k1KeyIdentity;

  async onModuleInit(): Promise<void> {
    await this.initializeAgent();
  }

  private async initializeAgent(): Promise<void> {
    // Create identity from seed phrase (stored in environment)
    this.identity = await Secp256k1KeyIdentity.fromSeedPhrase(
      Config.blockchain.icp.seedPhrase,
    );

    // Create HTTP agent connecting to ICP mainnet
    this.agent = await HttpAgent.create({
      host: Config.blockchain.icp.host, // 'https://icp-api.io'
      identity: this.identity,
    });

    // For local development, fetch root key
    if (Config.environment !== 'production') {
      await this.agent.fetchRootKey();
    }
  }

  getPrincipal(): Principal {
    return this.identity.getPrincipal();
  }

  getAgent(): HttpAgent {
    return this.agent;
  }

  createLedgerCanister(canisterId: string): IcrcLedgerCanister {
    return IcrcLedgerCanister.create({
      agent: this.agent,
      canisterId: Principal.fromText(canisterId),
    });
  }
}
```

### 4.2 ICP Deposit Service (Polling-based)

**File:** `src/integration/blockchain/icp/services/icp-deposit.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IcpClientService } from './icp-client.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { DepositRouteRepository } from 'src/subdomains/supporting/address-pool/deposit-route.repository';
import { Config } from 'src/config/config';

interface Transaction {
  id: bigint;
  transaction: {
    kind: string;
    burn?: { from: { owner: Principal; subaccount?: Uint8Array }; amount: bigint };
    mint?: { to: { owner: Principal; subaccount?: Uint8Array }; amount: bigint };
    transfer?: {
      from: { owner: Principal; subaccount?: Uint8Array };
      to: { owner: Principal; subaccount?: Uint8Array };
      amount: bigint;
    };
  };
  timestamp: bigint;
}

interface GetAccountTransactionsResponse {
  balance: bigint;
  transactions: Transaction[];
  oldest_tx_id?: bigint;
}

/**
 * ICP Deposit Detection Service
 *
 * Polls the official DFINITY Index Canister every 10 seconds
 * to detect new incoming transactions.
 */
@Injectable()
export class IcpDepositService {
  private readonly logger = new Logger(IcpDepositService.name);

  // Official DFINITY Index Canisters
  private readonly ICP_INDEX_CANISTER = 'qhbym-qaaaa-aaaaa-aaafq-cai';
  private readonly CKBTC_INDEX_CANISTER = 'n5wcd-faaaa-aaaar-qaaea-cai';

  // Track last processed transaction per deposit address
  private lastProcessedTx: Map<string, bigint> = new Map();

  constructor(
    private readonly icpClient: IcpClientService,
    private readonly payInService: PayInService,
    private readonly depositRouteRepo: DepositRouteRepository,
  ) {}

  /**
   * Main polling job - runs every 10 seconds
   * Checks all active ICP deposit addresses for new transactions
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkDeposits(): Promise<void> {
    if (!Config.blockchain.icp.enabled) return;

    try {
      // Get all active ICP deposit routes
      const routes = await this.depositRouteRepo.findActiveByBlockchain('InternetComputer');

      for (const route of routes) {
        await this.checkDepositsForAddress(route);
      }
    } catch (error) {
      this.logger.error(`Error checking ICP deposits: ${error.message}`, error.stack);
    }
  }

  /**
   * Check deposits for a single address
   */
  private async checkDepositsForAddress(route: any): Promise<void> {
    const { address, asset } = route.deposit;

    try {
      // Determine which index canister to use based on asset
      const indexCanister = this.getIndexCanisterForAsset(asset.uniqueName);

      // Parse the deposit address into owner + subaccount
      const account = this.parseIcpAddress(address);

      // Query transactions for this account
      const response = await this.getAccountTransactions(
        indexCanister,
        account.owner,
        account.subaccount,
      );

      // Process new transactions
      for (const tx of response.transactions) {
        await this.processTransaction(tx, route, asset);
      }
    } catch (error) {
      this.logger.warn(`Error checking deposits for ${address}: ${error.message}`);
    }
  }

  /**
   * Query account transactions from Index Canister
   */
  private async getAccountTransactions(
    indexCanisterId: string,
    owner: Principal,
    subaccount?: Uint8Array,
  ): Promise<GetAccountTransactionsResponse> {
    const indexActor = this.createIndexActor(indexCanisterId);

    const lastTxId = this.lastProcessedTx.get(owner.toText()) ?? BigInt(0);

    return indexActor.get_account_transactions({
      account: {
        owner,
        subaccount: subaccount ? [subaccount] : [],
      },
      start: [lastTxId],
      max_results: BigInt(100),
    });
  }

  /**
   * Process a single transaction
   */
  private async processTransaction(
    tx: Transaction,
    route: any,
    asset: any,
  ): Promise<void> {
    const txId = tx.id.toString();

    // Check if already processed
    const exists = await this.payInService.existsByTxId(txId);
    if (exists) {
      this.logger.debug(`Transaction ${txId} already processed, skipping`);
      return;
    }

    // Only process incoming transfers (not burns or outgoing)
    if (tx.transaction.kind !== 'transfer' && tx.transaction.kind !== 'mint') {
      return;
    }

    const transfer = tx.transaction.transfer || tx.transaction.mint;
    if (!transfer) return;

    // Verify this is an incoming transaction to our deposit address
    const toOwner = transfer.to?.owner;
    if (!toOwner || toOwner.toText() !== this.icpClient.getPrincipal().toText()) {
      return;
    }

    // Convert amount
    const decimals = asset.decimals || 8;
    const amount = Number(transfer.amount) / Math.pow(10, decimals);

    // Create PayIn entry
    await this.payInService.createPayIn({
      address: route.deposit.address,
      txId,
      txSequence: 0,
      blockHeight: Number(tx.id), // Use tx id as pseudo block height
      amount,
      asset,
      route,
    });

    this.logger.log(`Created PayIn for ${asset.uniqueName} deposit: ${txId}, amount: ${amount}`);

    // Update last processed tx
    this.lastProcessedTx.set(toOwner.toText(), tx.id);
  }

  /**
   * Create Index Canister actor
   */
  private createIndexActor(canisterId: string): any {
    // Simplified IDL - in production use generated Candid types
    const idlFactory = ({ IDL }: any) => {
      const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
      });

      const Transaction = IDL.Record({
        id: IDL.Nat,
        transaction: IDL.Record({
          kind: IDL.Text,
          burn: IDL.Opt(IDL.Record({ from: Account, amount: IDL.Nat })),
          mint: IDL.Opt(IDL.Record({ to: Account, amount: IDL.Nat })),
          transfer: IDL.Opt(IDL.Record({ from: Account, to: Account, amount: IDL.Nat })),
        }),
        timestamp: IDL.Nat64,
      });

      return IDL.Service({
        get_account_transactions: IDL.Func(
          [IDL.Record({
            account: Account,
            start: IDL.Opt(IDL.Nat),
            max_results: IDL.Nat,
          })],
          [IDL.Record({
            balance: IDL.Nat,
            transactions: IDL.Vec(Transaction),
            oldest_tx_id: IDL.Opt(IDL.Nat),
          })],
          ['query'],
        ),
      });
    };

    return Actor.createActor(idlFactory, {
      agent: this.icpClient.getAgent(),
      canisterId: Principal.fromText(canisterId),
    });
  }

  /**
   * Get Index Canister for asset type
   */
  private getIndexCanisterForAsset(assetName: string): string {
    switch (assetName) {
      case 'ICP':
        return this.ICP_INDEX_CANISTER;
      case 'ckBTC':
        return this.CKBTC_INDEX_CANISTER;
      case 'ckUSDC':
      case 'ckUSDT':
        // ICRC-1 tokens use their own index canisters
        return Config.blockchain.icp.indexCanisters[assetName] || this.ICP_INDEX_CANISTER;
      default:
        return this.ICP_INDEX_CANISTER;
    }
  }

  /**
   * Parse ICP address string into owner + subaccount
   * ICP has two address formats:
   * 1. Account Identifier (64-char hex for ICP legacy)
   * 2. ICRC-1 textual format (principal-checksum.subaccount)
   */
  private parseIcpAddress(address: string): { owner: Principal; subaccount?: Uint8Array } {
    // For ICRC-1 format: principal.subaccount
    if (address.includes('.')) {
      const [principalPart, subaccountPart] = address.split('.');
      return {
        owner: Principal.fromText(principalPart),
        subaccount: this.hexToBytes(subaccountPart),
      };
    }

    // For hex Account Identifier, we need to look up the corresponding subaccount
    // In DFX, we use route ID as subaccount index
    return {
      owner: this.icpClient.getPrincipal(),
      subaccount: this.deriveSubaccount(address),
    };
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  private deriveSubaccount(addressHex: string): Uint8Array {
    // Subaccount is 32 bytes, we use route ID encoded as big-endian
    // This will be implemented based on how addresses are generated
    const subaccount = new Uint8Array(32);
    // TODO: Implement based on address generation logic
    return subaccount;
  }
}
```

### 4.3 ICRC Ledger Service (For Payouts)

**File:** `src/integration/blockchain/icp/services/icrc-ledger.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { IcpClientService } from './icp-client.service';

export interface IcrcTransferParams {
  canisterId: string;
  to: {
    owner: Principal;
    subaccount?: Uint8Array;
  };
  amount: bigint;
  memo?: Uint8Array;
  fee?: bigint;
  fromSubaccount?: Uint8Array;
}

export interface IcrcTransferResult {
  success: boolean;
  blockIndex?: bigint;
  error?: string;
}

@Injectable()
export class IcrcLedgerService {
  constructor(private readonly icpClient: IcpClientService) {}

  /**
   * Get balance for an ICRC-1 token
   */
  async getBalance(
    canisterId: string,
    owner: Principal,
    subaccount?: Uint8Array,
  ): Promise<bigint> {
    const ledger = this.icpClient.createLedgerCanister(canisterId);

    return ledger.balance({
      owner,
      subaccount: subaccount ? [subaccount] : [],
    });
  }

  /**
   * Transfer ICRC-1 tokens (for payouts)
   */
  async transfer(params: IcrcTransferParams): Promise<IcrcTransferResult> {
    try {
      const ledger = this.icpClient.createLedgerCanister(params.canisterId);

      const result = await ledger.transfer({
        to: {
          owner: params.to.owner,
          subaccount: params.to.subaccount ? [params.to.subaccount] : [],
        },
        amount: params.amount,
        memo: params.memo ? [params.memo] : [],
        fee: params.fee ? [params.fee] : [],
        fromSubaccount: params.fromSubaccount ? [params.fromSubaccount] : [],
        createdAtTime: BigInt(Date.now() * 1_000_000), // Nanoseconds for deduplication
      });

      return {
        success: true,
        blockIndex: result,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Transfer failed',
      };
    }
  }

  /**
   * Get token metadata (symbol, name, decimals, fee)
   */
  async getMetadata(canisterId: string): Promise<{
    symbol: string;
    name: string;
    decimals: number;
    fee: bigint;
  }> {
    const ledger = this.icpClient.createLedgerCanister(canisterId);

    const [metadata, fee] = await Promise.all([
      ledger.metadata({}),
      ledger.transactionFee({}),
    ]);

    const metadataMap = new Map(metadata);

    return {
      symbol: this.extractTextMetadata(metadataMap, 'icrc1:symbol') || 'UNKNOWN',
      name: this.extractTextMetadata(metadataMap, 'icrc1:name') || 'Unknown Token',
      decimals: this.extractNatMetadata(metadataMap, 'icrc1:decimals') || 8,
      fee,
    };
  }

  private extractTextMetadata(metadata: Map<string, any>, key: string): string | undefined {
    const value = metadata.get(key);
    if (value && 'Text' in value) return value.Text;
    return undefined;
  }

  private extractNatMetadata(metadata: Map<string, any>, key: string): number | undefined {
    const value = metadata.get(key);
    if (value && 'Nat' in value) return Number(value.Nat);
    return undefined;
  }
}
```

### 4.4 ICP Address Service

**File:** `src/integration/blockchain/icp/services/icp-address.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { sha224 } from '@dfinity/principal/lib/cjs/utils/sha224';
import { getCrc32 } from '@dfinity/principal/lib/cjs/utils/getCrc';
import { IcpClientService } from './icp-client.service';

@Injectable()
export class IcpAddressService {
  constructor(private readonly icpClient: IcpClientService) {}

  /**
   * Generate a unique deposit address for a route
   *
   * Strategy: Use the route ID as a subaccount index.
   * This creates a unique deposit address per user/route while keeping
   * all funds under one principal (DFX's main wallet).
   *
   * @param routeId The unique route ID
   * @param format 'account_id' for ICP legacy, 'icrc1' for ICRC-1 tokens
   */
  generateDepositAddress(routeId: number, format: 'account_id' | 'icrc1' = 'account_id'): string {
    const principal = this.icpClient.getPrincipal();
    const subaccount = this.routeIdToSubaccount(routeId);

    if (format === 'icrc1') {
      // ICRC-1 textual format: principal-checksum.subaccount_hex
      return this.toIcrc1Address(principal, subaccount);
    } else {
      // Legacy Account Identifier (64-char hex)
      return this.toAccountIdentifier(principal, subaccount);
    }
  }

  /**
   * Convert route ID to 32-byte subaccount
   * Route ID is stored as big-endian in the last 4 bytes
   */
  private routeIdToSubaccount(routeId: number): Uint8Array {
    const subaccount = new Uint8Array(32);
    // Store route ID in last 4 bytes (big-endian)
    subaccount[28] = (routeId >> 24) & 0xff;
    subaccount[29] = (routeId >> 16) & 0xff;
    subaccount[30] = (routeId >> 8) & 0xff;
    subaccount[31] = routeId & 0xff;
    return subaccount;
  }

  /**
   * Extract route ID from subaccount
   */
  subaccountToRouteId(subaccount: Uint8Array): number {
    return (
      (subaccount[28] << 24) |
      (subaccount[29] << 16) |
      (subaccount[30] << 8) |
      subaccount[31]
    );
  }

  /**
   * Generate legacy Account Identifier (64-char hex)
   * Used for ICP native token
   */
  private toAccountIdentifier(principal: Principal, subaccount: Uint8Array): string {
    // Account ID = CRC32(SHA224(\x0Aaccount-id + principal + subaccount)) + SHA224(...)
    const data = new Uint8Array([
      0x0a, // Length prefix
      ...new TextEncoder().encode('account-id'),
      ...principal.toUint8Array(),
      ...subaccount,
    ]);

    const hash = sha224(data);
    const crc = getCrc32(hash);

    // CRC (4 bytes) + hash (28 bytes) = 32 bytes = 64 hex chars
    const accountId = new Uint8Array(32);
    accountId.set(crc, 0);
    accountId.set(hash, 4);

    return this.bytesToHex(accountId);
  }

  /**
   * Generate ICRC-1 textual address format
   * Used for ICRC-1 tokens (ckBTC, ckUSDC, etc.)
   */
  private toIcrc1Address(principal: Principal, subaccount: Uint8Array): string {
    // Check if subaccount is all zeros (default subaccount)
    const isDefaultSubaccount = subaccount.every(b => b === 0);

    if (isDefaultSubaccount) {
      return principal.toText();
    }

    // Format: principal.subaccount_hex (trimmed leading zeros)
    let subaccountHex = this.bytesToHex(subaccount);
    // Trim leading zeros but keep at least 2 chars
    subaccountHex = subaccountHex.replace(/^0+/, '') || '0';

    return `${principal.toText()}.${subaccountHex}`;
  }

  /**
   * Parse an ICP address into principal + subaccount
   */
  parseAddress(address: string): { owner: Principal; subaccount: Uint8Array } {
    // ICRC-1 format: principal.subaccount
    if (address.includes('.')) {
      const [principalText, subaccountHex] = address.split('.');
      return {
        owner: Principal.fromText(principalText),
        subaccount: this.hexToSubaccount(subaccountHex),
      };
    }

    // Check if it's a principal
    try {
      return {
        owner: Principal.fromText(address),
        subaccount: new Uint8Array(32),
      };
    } catch {
      // Assume it's an account identifier (64-char hex)
      // Note: Cannot reverse account ID to principal+subaccount (one-way hash)
      throw new Error('Cannot parse Account Identifier back to principal+subaccount');
    }
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private hexToSubaccount(hex: string): Uint8Array {
    const subaccount = new Uint8Array(32);
    const bytes = this.hexToBytes(hex);
    // Right-align in 32-byte array
    subaccount.set(bytes, 32 - bytes.length);
    return subaccount;
  }

  private hexToBytes(hex: string): Uint8Array {
    // Pad to even length
    if (hex.length % 2 !== 0) hex = '0' + hex;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }
}
```

---

## 5. PayIn Strategy (Polling-Based)

### 5.1 ICP Register Strategy

**File:** `src/subdomains/supporting/payin/strategies/register/impl/icp.strategy.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RegisterStrategy } from '../register.strategy';
import { IcpAddressService } from 'src/integration/blockchain/icp/services/icp-address.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';

/**
 * ICP PayIn Registration Strategy
 *
 * Generates deposit addresses for ICP routes.
 * Deposit detection is handled by IcpDepositService (cron job).
 */
@Injectable()
export class IcpRegisterStrategy extends RegisterStrategy {
  private readonly logger = new Logger(IcpRegisterStrategy.name);

  constructor(private readonly icpAddress: IcpAddressService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.InternetComputer;
  }

  /**
   * Generate deposit address for a new route
   * Uses subaccount system: one principal + unique subaccount per route
   */
  async generateDepositAddress(
    routeId: number,
    tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT' = 'ICP',
  ): Promise<string> {
    // Use ICRC-1 format for ICRC-1 tokens, Account Identifier for ICP
    const format = tokenType === 'ICP' ? 'account_id' : 'icrc1';
    return this.icpAddress.generateDepositAddress(routeId, format);
  }

  /**
   * Deposit checking happens via IcpDepositService cron job.
   * This method exists for interface compatibility.
   */
  async checkPayInEntries(): Promise<void> {
    // Deposit detection is handled by IcpDepositService polling
    this.logger.debug('ICP deposits are checked via IcpDepositService cron job');
  }
}
```

---

## 6. PayOut Strategy

### 6.1 ICP Payout Strategy

**File:** `src/subdomains/supporting/payout/strategies/payout/impl/icp.strategy.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { PayoutStrategy } from '../payout.strategy';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { IcrcLedgerService } from 'src/integration/blockchain/icp/services/icrc-ledger.service';
import { IcpAddressService } from 'src/integration/blockchain/icp/services/icp-address.service';
import { CkBtcService } from 'src/integration/blockchain/icp/services/ckbtc.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';

@Injectable()
export class IcpPayoutStrategy extends PayoutStrategy {
  constructor(
    private readonly icrcLedger: IcrcLedgerService,
    private readonly icpAddress: IcpAddressService,
    private readonly ckBtcService: CkBtcService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.InternetComputer;
  }

  /**
   * Execute payout for ICP-based tokens
   */
  async doPayout(order: PayoutOrder): Promise<string> {
    const { asset, address, amount } = order;

    // Determine canister ID based on asset
    const canisterId = this.getCanisterIdForAsset(asset.uniqueName);

    // Parse recipient address
    const { owner, subaccount } = this.icpAddress.parseAddress(address);

    // Convert amount to smallest unit
    const decimals = asset.decimals || 8;
    const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, decimals)));

    // Execute transfer
    const result = await this.icrcLedger.transfer({
      canisterId,
      to: { owner, subaccount },
      amount: amountInSmallestUnit,
    });

    if (!result.success) {
      throw new Error(`ICP payout failed: ${result.error}`);
    }

    return result.blockIndex?.toString() || '';
  }

  /**
   * Special handling for ckBTC -> real BTC withdrawals
   */
  async doPayoutToBitcoin(order: PayoutOrder): Promise<string> {
    const { address, amount } = order;

    // Convert to satoshis
    const amountSatoshis = BigInt(Math.floor(amount * 1e8));

    // Retrieve real BTC
    const result = await this.ckBtcService.retrieveBtc(address, amountSatoshis);

    return result.blockIndex.toString();
  }

  /**
   * Estimate fee for ICP transfer
   */
  async estimateFee(asset: string): Promise<number> {
    const canisterId = this.getCanisterIdForAsset(asset);
    const metadata = await this.icrcLedger.getMetadata(canisterId);

    // ICP fees are very low (0.0001 ICP typical)
    return Number(metadata.fee) / 1e8;
  }

  private getCanisterIdForAsset(assetName: string): string {
    const canisters = Config.blockchain.icp.canisters;

    const canisterMap: Record<string, string> = {
      ICP: canisters.icpLedger,
      ckBTC: canisters.ckbtcLedger,
      ckUSDC: canisters.ckusdcLedger,
      ckUSDT: canisters.ckusdtLedger,
      VCHF: canisters.vchfLedger,
      VEUR: canisters.veurLedger,
    };

    const canisterId = canisterMap[assetName];
    if (!canisterId) {
      throw new Error(`Unknown ICP asset: ${assetName}`);
    }

    return canisterId;
  }
}
```

---

## 7. Configuration

### 7.1 Environment Variables

```bash
# ICP Configuration
ICP_ENABLED=true
ICP_HOST=https://icp-api.io
ICP_SEED_PHRASE=your-24-word-seed-phrase-here

# Official DFINITY Index Canisters (for deposit detection)
ICP_INDEX_CANISTER_ID=qhbym-qaaaa-aaaaa-aaafq-cai
CKBTC_INDEX_CANISTER_ID=n5wcd-faaaa-aaaar-qaaea-cai

# Token Ledger Canister IDs (Mainnet)
ICP_LEDGER_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai
CKBTC_LEDGER_CANISTER_ID=mxzaz-hqaaa-aaaar-qaada-cai
CKBTC_MINTER_CANISTER_ID=mqygn-kiaaa-aaaar-qaadq-cai
CKUSDC_LEDGER_CANISTER_ID=xevnm-gaaaa-aaaar-qafnq-cai
CKUSDT_LEDGER_CANISTER_ID=cngnf-vqaaa-aaaar-qag4q-cai

# VNX Tokens (TBD - get from VNX)
VCHF_ICP_CANISTER_ID=
VEUR_ICP_CANISTER_ID=

# Polling interval (seconds)
ICP_POLLING_INTERVAL=10
```

### 7.2 Config Module Updates

**File:** `src/config/config.ts`

```typescript
export const Config = {
  // ... existing config

  blockchain: {
    // ... existing blockchains

    icp: {
      enabled: process.env.ICP_ENABLED === 'true',
      host: process.env.ICP_HOST || 'https://icp-api.io',
      seedPhrase: process.env.ICP_SEED_PHRASE,
      pollingInterval: parseInt(process.env.ICP_POLLING_INTERVAL || '10', 10),

      // Index Canisters (for deposit detection)
      indexCanisters: {
        icp: process.env.ICP_INDEX_CANISTER_ID || 'qhbym-qaaaa-aaaaa-aaafq-cai',
        ckbtc: process.env.CKBTC_INDEX_CANISTER_ID || 'n5wcd-faaaa-aaaar-qaaea-cai',
      },

      // Ledger Canisters
      canisters: {
        icpLedger: process.env.ICP_LEDGER_CANISTER_ID || 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        ckbtcLedger: process.env.CKBTC_LEDGER_CANISTER_ID || 'mxzaz-hqaaa-aaaar-qaada-cai',
        ckbtcMinter: process.env.CKBTC_MINTER_CANISTER_ID || 'mqygn-kiaaa-aaaar-qaadq-cai',
        ckusdcLedger: process.env.CKUSDC_LEDGER_CANISTER_ID || 'xevnm-gaaaa-aaaar-qafnq-cai',
        ckusdtLedger: process.env.CKUSDT_LEDGER_CANISTER_ID || 'cngnf-vqaaa-aaaar-qag4q-cai',
        vchfLedger: process.env.VCHF_ICP_CANISTER_ID,
        veurLedger: process.env.VEUR_ICP_CANISTER_ID,
      },
    },
  },
};
```

---

## 8. Database Schema Updates

### 8.1 New Asset Entries

```sql
-- ICP Token
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('ICP', 'Internet Computer', 'Coin', 'InternetComputer', NULL, 8);

-- ckBTC Token
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('ckBTC', 'Chain-Key Bitcoin', 'Token', 'InternetComputer', NULL, 8);

-- ckUSDC Token
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('ckUSDC', 'Chain-Key USDC', 'Token', 'InternetComputer', NULL, 6);

-- ckUSDT Token
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('ckUSDT', 'Chain-Key USDT', 'Token', 'InternetComputer', NULL, 6);

-- VCHF on ICP (pending canister deployment)
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('VCHF_ICP', 'VNX Swiss Franc (ICP)', 'Token', 'InternetComputer', NULL, 8);

-- VEUR on ICP (pending canister deployment)
INSERT INTO asset (uniqueName, name, type, blockchain, chainId, decimals)
VALUES ('VEUR_ICP', 'VNX Euro (ICP)', 'Token', 'InternetComputer', NULL, 8);
```

### 8.2 Blockchain Enum Migration

```sql
-- Add InternetComputer to blockchain enum
ALTER TYPE blockchain_enum ADD VALUE 'InternetComputer';
```

---

## 9. Deposit Detection Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEPOSIT FLOW                                      │
└─────────────────────────────────────────────────────────────────────────────┘

1. USER REQUESTS DEPOSIT ADDRESS
   ┌─────────┐                      ┌─────────────┐
   │   User  │─── GET /buy/... ───>│  DFX API    │
   └─────────┘                      └──────┬──────┘
                                           │
                                           v
                                   ┌───────────────┐
                                   │ IcpAddress    │
                                   │ .generate...  │
                                   └──────┬────────┘
                                          │
                                          v
                              ┌─────────────────────────┐
                              │ Deposit Address:        │
                              │ Principal + Subaccount  │
                              │ (Route ID encoded)      │
                              └─────────────────────────┘

2. USER SENDS TOKENS
   ┌─────────┐                      ┌─────────────┐
   │   User  │─── Send ICP/ckBTC ─>│ ICP Ledger  │
   │ Wallet  │     to deposit addr │  Canister   │
   └─────────┘                      └─────────────┘

3. DFX POLLING DETECTS DEPOSIT (every 10 seconds)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                           DFX API Backend                                │
   │                                                                          │
   │   ┌──────────────────────┐       ┌──────────────┐                        │
   │   │ IcpDepositService    │─poll─>│ ICP Index    │                        │
   │   │ @Cron(EVERY_10_SEC)  │       │ Canister     │                        │
   │   └──────────┬───────────┘       │ (DFINITY)    │                        │
   │              │                   └──────────────┘                        │
   │              │ New TX found!                                             │
   │              v                                                           │
   │   ┌──────────────────────┐       ┌─────────────┐                         │
   │   │   PayInService       │──────>│  Database   │                         │
   │   │   .createPayIn       │       │  (PayIn)    │                         │
   │   └──────────────────────┘       └─────────────┘                         │
   │                                                                          │
   └──────────────────────────────────────────────────────────────────────────┘

4. LIQUIDITY CONSOLIDATION (separate cron job)
   ┌──────────────────┐              ┌──────────────┐
   │ IcpLiquidity     │─── sweep ───>│ ICP Ledger   │
   │ Service          │              │ Canister     │
   └──────────────────┘              └──────┬───────┘
                                            │
                                            v
                                   ┌────────────────┐
                                   │ Funds moved to │
                                   │ main liquidity │
                                   │    wallet      │
                                   └────────────────┘
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
describe('IcpAddressService', () => {
  it('should generate valid ICP deposit address', () => {
    const address = icpAddress.generateDepositAddress(12345, 'account_id');
    expect(address).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate valid ICRC-1 deposit address', () => {
    const address = icpAddress.generateDepositAddress(12345, 'icrc1');
    expect(address).toContain('.');
  });

  it('should correctly encode/decode route ID in subaccount', () => {
    const routeId = 12345;
    const subaccount = icpAddress.routeIdToSubaccount(routeId);
    const decoded = icpAddress.subaccountToRouteId(subaccount);
    expect(decoded).toBe(routeId);
  });
});

describe('IcpDepositService', () => {
  it('should detect new deposits', async () => {
    // Mock Index Canister response
    const mockTx = { id: BigInt(1), transaction: { kind: 'transfer', ... } };
    jest.spyOn(depositService, 'getAccountTransactions').mockResolvedValue({
      balance: BigInt(1000000),
      transactions: [mockTx],
    });

    await depositService.checkDeposits();

    expect(payInService.createPayIn).toHaveBeenCalled();
  });

  it('should skip already processed transactions', async () => {
    jest.spyOn(payInService, 'existsByTxId').mockResolvedValue(true);

    await depositService.checkDeposits();

    expect(payInService.createPayIn).not.toHaveBeenCalled();
  });
});
```

### 10.2 Integration Tests

```bash
# Test ICP deposit detection
# 1. Generate deposit address
curl -X GET "http://localhost:3000/v1/buy?blockchain=InternetComputer&asset=ICP"

# 2. Send test ICP to the address (using dfx or NNS app)
dfx ledger transfer <deposit_address> --amount 0.001

# 3. Wait 10-20 seconds for polling to detect
# 4. Check transaction was created
curl -X GET "http://localhost:3000/v1/transaction"
```

---

## 11. Deployment Checklist

### Phase 1: Infrastructure Setup
- [ ] Install NPM dependencies (`@dfinity/agent`, `@dfinity/ledger-icrc`, etc.)
- [ ] Update TypeScript configuration
- [ ] Add ICP to Blockchain enum
- [ ] Create ICP module and services
- [ ] Add environment variables to all environments

### Phase 2: Core Implementation
- [ ] Implement IcpClientService
- [ ] Implement IcpAddressService
- [ ] Implement IcpDepositService (polling)
- [ ] Implement IcrcLedgerService
- [ ] Write unit tests

### Phase 3: PayIn/PayOut Integration
- [ ] Implement IcpRegisterStrategy
- [ ] Implement IcpPayoutStrategy
- [ ] Register strategies in respective modules
- [ ] Test deposit detection (10-second polling)
- [ ] Test payouts

### Phase 4: Database & Assets
- [ ] Run database migrations
- [ ] Add ICP/ckBTC/ckUSDC/ckUSDT assets
- [ ] Configure asset pricing sources

### Phase 5: VCHF/VEUR Integration
- [ ] **BLOCKER:** Wait for VNX canister deployment
- [ ] Add VCHF/VEUR canister IDs to config
- [ ] Add VCHF/VEUR assets to database
- [ ] Test VCHF/VEUR transfers

### Phase 6: Production Deployment
- [ ] Security review of seed phrase handling
- [ ] Monitoring setup for polling job health
- [ ] Alerting for failed deposit detection
- [ ] Documentation for operations team

---

## 12. Risk Assessment

### 12.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Index Canister unavailable | Low | DFINITY-maintained, high availability |
| Polling job fails | Medium | Health monitoring, alerting, auto-restart |
| VCHF/VEUR not deployed yet | High | Blocker - coordinate with VNX |
| Seed phrase security | Critical | Use HSM or secure vault |

### 12.2 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deposit detection latency | Low | 10-second polling provides good UX |
| Missed transactions | Low | Persistent last-processed tracking |
| ckBTC minting delays | Medium | Set user expectations (BTC confirmations) |

---

## 13. Open Questions for Technical Integration Call

1. **VCHF/VEUR Deployment Timeline:**
   - When will VNX deploy VCHF/VEUR canisters on ICP?
   - What are the canister IDs?

2. **Index Canister for Custom ICRC-1:**
   - Does VNX deploy their own index canister for VCHF/VEUR?
   - Or should we deploy one?

3. **Testnet Environment:**
   - Recommended testnet for ICP integration testing?
   - ckBTC testnet minter availability?

4. **ckBTC ↔ BTC:**
   - Minimum amounts for BTC → ckBTC minting?
   - Expected confirmation times?

---

## 14. References

- [DFINITY Index Canisters Documentation](https://docs.internetcomputer.org/defi/token-indexes/)
- [ICP JavaScript SDK Documentation](https://js.icp.build/)
- [ICRC-1 Token Standard](https://github.com/dfinity/ICRC-1)
- [ckBTC Documentation](https://docs.internetcomputer.org/defi/chain-key-tokens/ckbtc/overview)
- [Rosetta API for ICP](https://docs.internetcomputer.org/defi/rosetta/icp_rosetta/)
- [Principal vs Account ID](https://medium.com/plugwallet/internet-computer-ids-101-669b192a2ace)
- [VNX Official Website](https://vnx.li/)

---

*Document created: January 2026*
*Last updated: January 2026*
*Author: DFX Engineering Team*
