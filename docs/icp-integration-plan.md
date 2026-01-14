# ICP Blockchain Integration Plan

## Overview

This document outlines the technical implementation plan for integrating the Internet Computer Protocol (ICP) blockchain into the DFX payment infrastructure, as per the contract with DFINITY Stiftung (signed January 2026).

### Scope of Integration

| Token | Blockchain | Priority |
|-------|------------|----------|
| ICP | Internet Computer | High |
| ckBTC | Internet Computer | High |
| VCHF | Internet Computer | High |
| VEUR | Internet Computer | High |
| VCHF | Base | Medium (already EVM) |
| VEUR | Base | Medium (already EVM) |
| VCHF | Solana | Medium |
| VEUR | Solana | Medium |

---

## 1. Architecture Overview

### 1.1 Key Differences: ICP vs EVM Chains

| Aspect | Ethereum/EVM (Current) | ICP (New) |
|--------|------------------------|-----------|
| RPC Provider | Alchemy, Tatum | **Not needed** - built into protocol |
| API Endpoint | Provider-specific | Public: `icp-api.io`, `icp0.io` |
| Protocol | JSON-RPC | **Candid** (IDL) |
| Addresses | Hex (0x...) | **Principal ID** + **Account Identifier** |
| Token Standard | ERC-20 | **ICRC-1 / ICRC-2** |
| Webhooks | Alchemy Webhooks | **ICSI Webhooks** (via indexer canister) |
| Transaction Finality | ~12 confirmations | **~2 seconds** |
| Gas Model | ETH for gas | **Cycles** (prepaid by canister) |

### 1.2 ICP Network Architecture with ICSI

```
┌─────────────────────────────────────────────────────────────────┐
│                        DFX API Backend                          │
│                     (NestJS Application)                        │
└──────────────┬──────────────────────────────────┬───────────────┘
               │                                  │
               │ Webhook POST                     │ Canister Calls
               │ (Real-time deposit               │ (Payouts, sweeps)
               │  notifications)                  │
               ▼                                  ▼
┌──────────────────────────┐    ┌─────────────────────────────────┐
│   ICP Webhook Controller │    │        IcpClientService         │
│   POST /webhook/icp      │    │    (@dfinity/agent + icsi-lib)  │
└──────────────────────────┘    └────────────────┬────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ICSI Canister (Indexer)                      │
│              Mainnet: qvn3w-rqaaa-aaaam-qd4kq-cai               │
│                                                                 │
│  Features:                                                      │
│  - Webhook notifications for deposits (PUSH, not POLL!)         │
│  - Manages 10,000+ subaccounts efficiently                      │
│  - Multi-token support (ICP, ckBTC, ckUSDC, ckUSDT)             │
│  - Automatic sweep to main liquidity wallet                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌───────────┐      ┌───────────┐      ┌───────────┐
   │    ICP    │      │   ckBTC   │      │ VCHF/VEUR │
   │  Ledger   │      │  Ledger   │      │  Ledger   │
   │ Canister  │      │ Canister  │      │ Canister  │
   └───────────┘      └───────────┘      └───────────┘
```

### 1.3 Why ICSI Instead of Polling?

**Problem with naive polling:**
- DFX has thousands of customers with individual deposit addresses
- Polling each address separately = thousands of API calls per interval
- Not scalable, high latency, wasteful

**ICSI Solution:**
- One indexer canister manages ALL subaccounts under one principal
- ICSI polls the ledgers internally (configurable interval)
- When deposit detected → **Webhook POST to DFX backend**
- DFX receives real-time notifications without any polling
- Scales to **tens of thousands of subaccounts**

### 1.4 Canister IDs

| Component | Canister ID | Notes |
|-----------|-------------|-------|
| **ICSI (Indexer)** | `qvn3w-rqaaa-aaaam-qd4kq-cai` | Production indexer |
| ICP Ledger | `ryjl3-tyaaa-aaaaa-aaaba-cai` | Native token |
| ckBTC Ledger | `mxzaz-hqaaa-aaaar-qaada-cai` | Chain-key Bitcoin |
| ckBTC Minter | `mqygn-kiaaa-aaaar-qaadq-cai` | BTC ↔ ckBTC |
| ckUSDC Ledger | `xevnm-gaaaa-aaaar-qafnq-cai` | Chain-key USDC |
| ckUSDT Ledger | `cngnf-vqaaa-aaaar-qag4q-cai` | Chain-key USDT |
| VCHF Ledger | **TBD** | Pending VNX deployment |
| VEUR Ledger | **TBD** | Pending VNX deployment |

---

## 2. Required Dependencies

### 2.1 NPM Packages

```bash
# Core ICP Agent
npm install @dfinity/agent @dfinity/principal @dfinity/candid

# Identity Management (for wallet/signing)
npm install @dfinity/identity-secp256k1

# ICRC-1/2 Token Interaction
npm install @dfinity/ledger-icrc

# ICSI SDK (Sub-Account Indexer with Webhooks)
npm install icsi-lib

# Specific for ckBTC (minting/burning from real BTC)
npm install @dfinity/ckbtc

# ICP Ledger specific (for native ICP transfers)
npm install @dfinity/ledger-icp

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
│           │   ├── icsi-indexer.service.ts        # ICSI integration (NEW!)
│           │   ├── icrc-ledger.service.ts         # Generic ICRC-1/2 tokens
│           │   ├── ckbtc.service.ts               # ckBTC operations
│           │   └── icp-address.service.ts         # Address generation
│           ├── controllers/
│           │   └── icp-webhook.controller.ts      # Webhook receiver (NEW!)
│           ├── dto/
│           │   ├── icp-webhook.dto.ts             # Webhook payload (NEW!)
│           │   ├── icp-transfer.dto.ts
│           │   └── icp-account.dto.ts
│           └── __tests__/
│               ├── icp-client.service.spec.ts
│               └── icsi-indexer.service.spec.ts
│
├── subdomains/
│   └── supporting/
│       ├── payin/
│       │   └── strategies/
│       │       └── register/
│       │           └── impl/
│       │               └── icp.strategy.ts        # Webhook-based PayIn
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

### 4.2 ICSI Indexer Service (Webhook-based Deposit Detection)

**File:** `src/integration/blockchain/icp/services/icsi-indexer.service.ts`

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { IcpClientService } from './icp-client.service';
import { Config } from 'src/config/config';

// ICSI Token Types
type TokenType =
  | { ICP: null }
  | { CKBTC: null }
  | { CKUSDC: null }
  | { CKUSDT: null };

interface IcsiTransaction {
  tx_hash: string;
  token_type: TokenType;
  from_account: string;
  to_subaccount: number;
  amount: bigint;
  timestamp: bigint;
}

// ICSI Canister Interface (from icsi-lib)
interface IcsiCanister {
  // Deposit address generation
  add_subaccount: (tokenType: TokenType) => Promise<{ Ok: string } | { Err: string }>;
  generate_icp_deposit_address: (subaccountIndex: number) => Promise<string>;
  generate_icrc1_deposit_address: (tokenType: TokenType, subaccountIndex: number) => Promise<string>;

  // Balance & transactions
  get_balance: (tokenType: TokenType) => Promise<bigint>;
  get_transactions_count: () => Promise<bigint>;
  list_transactions: (limit?: bigint) => Promise<IcsiTransaction[]>;
  get_transaction: (txHash: string) => Promise<IcsiTransaction | null>;

  // Webhook configuration
  set_webhook_url: (url: string) => Promise<void>;
  get_webhook_url: () => Promise<string | null>;

  // Sweep operations (move funds to main liquidity wallet)
  sweep: (tokenType: TokenType) => Promise<{ Ok: string[] } | { Err: string }>;
  single_sweep: (tokenType: TokenType, subaccount: string) => Promise<{ Ok: string[] } | { Err: string }>;
  sweep_all: (tokenType: TokenType) => Promise<{ Ok: string[] } | { Err: string }>;
}

@Injectable()
export class IcsiIndexerService implements OnModuleInit {
  private readonly logger = new Logger(IcsiIndexerService.name);
  private icsiCanister: IcsiCanister;

  // Production ICSI Canister ID
  private readonly ICSI_CANISTER_ID = 'qvn3w-rqaaa-aaaam-qd4kq-cai';

  constructor(private readonly icpClient: IcpClientService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeIcsi();
    await this.configureWebhook();
  }

  private async initializeIcsi(): Promise<void> {
    // Create ICSI actor using the ICP agent
    this.icsiCanister = Actor.createActor<IcsiCanister>(
      // IDL factory would be imported from icsi-lib
      ({ IDL }) => {
        const TokenType = IDL.Variant({
          ICP: IDL.Null,
          CKBTC: IDL.Null,
          CKUSDC: IDL.Null,
          CKUSDT: IDL.Null,
        });

        return IDL.Service({
          add_subaccount: IDL.Func([IDL.Opt(TokenType)], [IDL.Variant({ Ok: IDL.Text, Err: IDL.Text })], []),
          get_balance: IDL.Func([TokenType], [IDL.Nat], ['query']),
          set_webhook_url: IDL.Func([IDL.Text], [], []),
          get_webhook_url: IDL.Func([], [IDL.Opt(IDL.Text)], ['query']),
          sweep: IDL.Func([TokenType], [IDL.Variant({ Ok: IDL.Vec(IDL.Text), Err: IDL.Text })], []),
          // ... other methods
        });
      },
      {
        agent: this.icpClient.getAgent(),
        canisterId: Principal.fromText(this.ICSI_CANISTER_ID),
      },
    );

    this.logger.log(`ICSI Indexer initialized with canister ${this.ICSI_CANISTER_ID}`);
  }

  /**
   * Configure ICSI to send webhooks to our endpoint
   */
  private async configureWebhook(): Promise<void> {
    const webhookUrl = Config.blockchain.icp.webhookUrl; // e.g., 'https://api.dfx.swiss/v1/webhook/icp'

    if (!webhookUrl) {
      this.logger.warn('ICP webhook URL not configured');
      return;
    }

    try {
      await this.icsiCanister.set_webhook_url(webhookUrl);
      this.logger.log(`ICSI webhook configured: ${webhookUrl}`);
    } catch (error) {
      this.logger.error(`Failed to configure ICSI webhook: ${error.message}`);
    }
  }

  /**
   * Generate a new deposit address for a user
   * Returns different formats based on token type:
   * - ICP: Hex account identifier (64 chars)
   * - ICRC-1 tokens: Textual format (canister-id-checksum.index)
   */
  async generateDepositAddress(
    tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT',
    routeId: number,
  ): Promise<string> {
    const token = this.mapTokenType(tokenType);

    if (tokenType === 'ICP') {
      return this.icsiCanister.generate_icp_deposit_address(routeId);
    } else {
      return this.icsiCanister.generate_icrc1_deposit_address(token, routeId);
    }
  }

  /**
   * Add a new subaccount (alternative to using route ID)
   */
  async addSubaccount(tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT'): Promise<string> {
    const token = this.mapTokenType(tokenType);
    const result = await this.icsiCanister.add_subaccount(token);

    if ('Ok' in result) {
      return result.Ok;
    }

    throw new Error(`Failed to add subaccount: ${result.Err}`);
  }

  /**
   * Get total balance across all subaccounts for a token type
   */
  async getTotalBalance(tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT'): Promise<bigint> {
    const token = this.mapTokenType(tokenType);
    return this.icsiCanister.get_balance(token);
  }

  /**
   * Sweep all funds from subaccounts to main liquidity wallet
   * Called after processing deposits
   */
  async sweepToLiquidity(tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT'): Promise<string[]> {
    const token = this.mapTokenType(tokenType);
    const result = await this.icsiCanister.sweep(token);

    if ('Ok' in result) {
      this.logger.log(`Swept ${result.Ok.length} subaccounts for ${tokenType}`);
      return result.Ok;
    }

    throw new Error(`Sweep failed: ${result.Err}`);
  }

  /**
   * Sweep a specific subaccount
   */
  async sweepSubaccount(
    tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT',
    subaccountAddress: string,
  ): Promise<string[]> {
    const token = this.mapTokenType(tokenType);
    const result = await this.icsiCanister.single_sweep(token, subaccountAddress);

    if ('Ok' in result) {
      return result.Ok;
    }

    throw new Error(`Single sweep failed: ${result.Err}`);
  }

  /**
   * Get transaction by hash (for webhook verification)
   */
  async getTransaction(txHash: string): Promise<IcsiTransaction | null> {
    return this.icsiCanister.get_transaction(txHash);
  }

  /**
   * Get recent transactions
   */
  async listTransactions(limit: number = 100): Promise<IcsiTransaction[]> {
    return this.icsiCanister.list_transactions(BigInt(limit));
  }

  private mapTokenType(token: string): TokenType {
    switch (token) {
      case 'ICP': return { ICP: null };
      case 'ckBTC': return { CKBTC: null };
      case 'ckUSDC': return { CKUSDC: null };
      case 'ckUSDT': return { CKUSDT: null };
      default: throw new Error(`Unknown token type: ${token}`);
    }
  }
}
```

### 4.3 ICP Webhook Controller

**File:** `src/integration/blockchain/icp/controllers/icp-webhook.controller.ts`

```typescript
import { Controller, Post, Query, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { IcsiIndexerService } from '../services/icsi-indexer.service';

/**
 * Webhook Controller for ICP Deposits via ICSI
 *
 * ICSI sends POST requests when deposits are detected:
 * POST /webhook/icp?tx_hash=<transaction_hash>
 *
 * This is PUSH-based (not polling!) - real-time notifications
 */
@Controller('webhook/icp')
export class IcpWebhookController {
  private readonly logger = new Logger(IcpWebhookController.name);

  constructor(
    private readonly icsiIndexer: IcsiIndexerService,
    private readonly payInService: PayInService,
  ) {}

  /**
   * Handle incoming deposit notification from ICSI
   * Called automatically when someone sends ICP/ckBTC/etc. to a deposit address
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async handleDepositWebhook(@Query('tx_hash') txHash: string): Promise<{ success: boolean }> {
    this.logger.log(`Received ICP deposit webhook: tx_hash=${txHash}`);

    try {
      // 1. Fetch transaction details from ICSI
      const transaction = await this.icsiIndexer.getTransaction(txHash);

      if (!transaction) {
        this.logger.warn(`Transaction not found: ${txHash}`);
        return { success: false };
      }

      // 2. Map token type to asset
      const asset = this.mapTokenToAsset(transaction.token_type);

      // 3. Find the route by subaccount (deposit address)
      const route = await this.findRouteBySubaccount(transaction.to_subaccount);

      if (!route) {
        this.logger.warn(`Route not found for subaccount: ${transaction.to_subaccount}`);
        return { success: false };
      }

      // 4. Create PayIn entry
      await this.payInService.createPayIn({
        address: route.deposit.address,
        txId: txHash,
        txSequence: 0,
        blockHeight: 0, // ICP doesn't have traditional blocks
        amount: this.convertAmount(transaction.amount, asset),
        asset: asset,
        route: route,
      });

      this.logger.log(`Created PayIn for ${asset} deposit: ${txHash}`);

      // 5. Trigger sweep to move funds to liquidity wallet
      await this.icsiIndexer.sweepSubaccount(
        this.getTokenTypeString(transaction.token_type),
        transaction.to_subaccount.toString(),
      );

      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing ICP webhook: ${error.message}`, error.stack);
      return { success: false };
    }
  }

  private mapTokenToAsset(tokenType: any): any {
    if ('ICP' in tokenType) return { uniqueName: 'ICP', decimals: 8 };
    if ('CKBTC' in tokenType) return { uniqueName: 'ckBTC', decimals: 8 };
    if ('CKUSDC' in tokenType) return { uniqueName: 'ckUSDC', decimals: 6 };
    if ('CKUSDT' in tokenType) return { uniqueName: 'ckUSDT', decimals: 6 };
    throw new Error(`Unknown token type: ${JSON.stringify(tokenType)}`);
  }

  private getTokenTypeString(tokenType: any): 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT' {
    if ('ICP' in tokenType) return 'ICP';
    if ('CKBTC' in tokenType) return 'ckBTC';
    if ('CKUSDC' in tokenType) return 'ckUSDC';
    if ('CKUSDT' in tokenType) return 'ckUSDT';
    throw new Error(`Unknown token type`);
  }

  private convertAmount(amount: bigint, asset: { decimals: number }): number {
    return Number(amount) / Math.pow(10, asset.decimals);
  }

  private async findRouteBySubaccount(subaccount: number): Promise<any> {
    // Implementation depends on how routes are stored
    // The subaccount index maps to the route ID
    return null; // TODO: Implement route lookup
  }
}
```

### 4.4 ICRC Ledger Service (For Payouts)

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

---

## 5. PayIn Strategy (Webhook-Based)

### 5.1 ICP Register Strategy

**File:** `src/subdomains/supporting/payin/strategies/register/impl/icp.strategy.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RegisterStrategy } from '../register.strategy';
import { IcsiIndexerService } from 'src/integration/blockchain/icp/services/icsi-indexer.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';

/**
 * ICP PayIn Registration Strategy
 *
 * KEY DIFFERENCE FROM OTHER BLOCKCHAINS:
 * - NO polling! Deposits are detected via ICSI webhooks
 * - Real-time notifications when funds arrive
 * - Scales to tens of thousands of deposit addresses
 *
 * The actual deposit detection happens in IcpWebhookController.
 * This strategy is only used for:
 * - Generating new deposit addresses
 * - Verifying/reconciling deposits if needed
 */
@Injectable()
export class IcpRegisterStrategy extends RegisterStrategy {
  private readonly logger = new Logger(IcpRegisterStrategy.name);

  constructor(private readonly icsiIndexer: IcsiIndexerService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.InternetComputer;
  }

  /**
   * Generate deposit address for a new route
   * Uses ICSI subaccount system for efficient management
   */
  async generateDepositAddress(
    routeId: number,
    tokenType: 'ICP' | 'ckBTC' | 'ckUSDC' | 'ckUSDT' = 'ICP',
  ): Promise<string> {
    return this.icsiIndexer.generateDepositAddress(tokenType, routeId);
  }

  /**
   * NO-OP: Deposits are detected via webhooks, not polling
   *
   * This method exists for interface compatibility but does nothing.
   * Real deposit detection happens in IcpWebhookController when ICSI
   * sends POST /webhook/icp?tx_hash=...
   */
  async checkPayInEntries(): Promise<void> {
    // Intentionally empty - webhook-based detection
    this.logger.debug('ICP deposits are webhook-based, no polling needed');
  }

  /**
   * Manual reconciliation if needed (e.g., missed webhooks)
   */
  async reconcileDeposits(): Promise<void> {
    const transactions = await this.icsiIndexer.listTransactions(1000);

    for (const tx of transactions) {
      // Check if this transaction was already processed
      const exists = await this.checkTransactionExists(tx.tx_hash);
      if (!exists) {
        this.logger.warn(`Found unprocessed ICP transaction: ${tx.tx_hash}`);
        // Process it manually...
      }
    }
  }

  private async checkTransactionExists(txHash: string): Promise<boolean> {
    // TODO: Check if PayIn exists with this txId
    return false;
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
import { CkBtcService } from 'src/integration/blockchain/icp/services/ckbtc.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';
import { Config } from 'src/config/config';

@Injectable()
export class IcpPayoutStrategy extends PayoutStrategy {
  constructor(
    private readonly icrcLedger: IcrcLedgerService,
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

    // Parse recipient address (must be Principal ID)
    const owner = Principal.fromText(address);

    // Convert amount to smallest unit
    const decimals = asset.decimals || 8;
    const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, decimals)));

    // Execute transfer
    const result = await this.icrcLedger.transfer({
      canisterId,
      to: { owner },
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
ICP_HOST=https://icp-api.io
ICP_SEED_PHRASE=your-24-word-seed-phrase-here

# ICSI Webhook URL (where ICSI sends deposit notifications)
ICP_WEBHOOK_URL=https://api.dfx.swiss/v1/webhook/icp

# ICSI Canister (Sub-Account Indexer)
ICSI_CANISTER_ID=qvn3w-rqaaa-aaaam-qd4kq-cai

# Token Ledger Canister IDs (Mainnet)
ICP_LEDGER_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai
CKBTC_LEDGER_CANISTER_ID=mxzaz-hqaaa-aaaar-qaada-cai
CKBTC_MINTER_CANISTER_ID=mqygn-kiaaa-aaaar-qaadq-cai
CKUSDC_LEDGER_CANISTER_ID=xevnm-gaaaa-aaaar-qafnq-cai
CKUSDT_LEDGER_CANISTER_ID=cngnf-vqaaa-aaaar-qag4q-cai

# VNX Tokens (TBD - get from VNX)
VCHF_ICP_CANISTER_ID=
VEUR_ICP_CANISTER_ID=

# Testnet
CKBTC_TESTNET_LEDGER_CANISTER_ID=mc6ru-gyaaa-aaaar-qaaaq-cai
CKBTC_TESTNET_MINTER_CANISTER_ID=ml52i-qqaaa-aaaar-qaaba-cai
```

### 7.2 Config Module Updates

**File:** `src/config/config.ts`

```typescript
export const Config = {
  // ... existing config

  blockchain: {
    // ... existing blockchains

    icp: {
      host: process.env.ICP_HOST || 'https://icp-api.io',
      seedPhrase: process.env.ICP_SEED_PHRASE,
      webhookUrl: process.env.ICP_WEBHOOK_URL,

      // ICSI Indexer
      icsiCanisterId: process.env.ICSI_CANISTER_ID || 'qvn3w-rqaaa-aaaam-qd4kq-cai',

      canisters: {
        icpLedger: process.env.ICP_LEDGER_CANISTER_ID || 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        ckbtcLedger: process.env.CKBTC_LEDGER_CANISTER_ID || 'mxzaz-hqaaa-aaaar-qaada-cai',
        ckbtcMinter: process.env.CKBTC_MINTER_CANISTER_ID || 'mqygn-kiaaa-aaaar-qaadq-cai',
        ckusdcLedger: process.env.CKUSDC_LEDGER_CANISTER_ID || 'xevnm-gaaaa-aaaar-qafnq-cai',
        ckusdtLedger: process.env.CKUSDT_LEDGER_CANISTER_ID || 'cngnf-vqaaa-aaaar-qag4q-cai',
        vchfLedger: process.env.VCHF_ICP_CANISTER_ID,
        veurLedger: process.env.VEUR_ICP_CANISTER_ID,
      },

      testnet: {
        ckbtcLedger: process.env.CKBTC_TESTNET_LEDGER_CANISTER_ID || 'mc6ru-gyaaa-aaaar-qaaaq-cai',
        ckbtcMinter: process.env.CKBTC_TESTNET_MINTER_CANISTER_ID || 'ml52i-qqaaa-aaaar-qaaba-cai',
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

## 9. ICSI Webhook Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEPOSIT FLOW                                      │
└─────────────────────────────────────────────────────────────────────────────┘

1. USER REQUESTS DEPOSIT ADDRESS
   ┌─────────┐                      ┌─────────────┐
   │   User  │─── GET /buy/... ───▶│  DFX API    │
   └─────────┘                      └──────┬──────┘
                                           │
                                           ▼
                                   ┌──────────────┐
                                   │ IcsiIndexer  │
                                   │ .generate... │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │    ICSI      │
                                   │  Canister    │
                                   └──────┬───────┘
                                          │
                                          ▼
                              ┌─────────────────────────┐
                              │ Deposit Address:        │
                              │ bd54f8b5e0fe4c6b...     │
                              └─────────────────────────┘

2. USER SENDS TOKENS
   ┌─────────┐                      ┌─────────────┐
   │   User  │─── Send ICP/ckBTC ─▶│ ICP Ledger  │
   │ Wallet  │     to deposit addr │  Canister   │
   └─────────┘                      └─────────────┘

3. ICSI DETECTS DEPOSIT (internal polling, ~15-60s interval)
                                   ┌──────────────┐
                                   │    ICSI      │
                                   │  Canister    │
                                   │              │
                                   │ "New TX      │
                                   │  detected!"  │
                                   └──────┬───────┘
                                          │
                                          │ POST /webhook/icp?tx_hash=abc123
                                          ▼
4. WEBHOOK NOTIFICATION
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                           DFX API Backend                                │
   │                                                                          │
   │   ┌──────────────────────┐       ┌──────────────┐      ┌─────────────┐  │
   │   │ IcpWebhookController │──────▶│  PayInService│─────▶│  Database   │  │
   │   │ POST /webhook/icp    │       │  .createPayIn│      │  (PayIn)    │  │
   │   └──────────────────────┘       └──────────────┘      └─────────────┘  │
   │                                                                          │
   └──────────────────────────────────────────────────────────────────────────┘

5. SWEEP TO LIQUIDITY
   ┌──────────────────┐              ┌──────────────┐
   │ IcsiIndexer      │─── sweep ───▶│    ICSI      │
   │ .sweepSubaccount │              │  Canister    │
   └──────────────────┘              └──────┬───────┘
                                            │
                                            ▼
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
describe('IcsiIndexerService', () => {
  it('should generate valid ICP deposit address', async () => {
    const address = await icsiIndexer.generateDepositAddress('ICP', 12345);
    expect(address).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate valid ICRC-1 deposit address', async () => {
    const address = await icsiIndexer.generateDepositAddress('ckBTC', 12345);
    expect(address).toMatch(/^[a-z0-9-]+\.[0-9]+$/);
  });
});

describe('IcpWebhookController', () => {
  it('should process valid webhook', async () => {
    const response = await controller.handleDepositWebhook('abc123');
    expect(response.success).toBe(true);
  });

  it('should handle unknown transaction', async () => {
    const response = await controller.handleDepositWebhook('unknown');
    expect(response.success).toBe(false);
  });
});
```

### 10.2 Integration Tests

```bash
# Test ICP deposit flow using ICSI test commands
pnpm run lib:test:webhook   # Start local webhook server
pnpm run lib:test:icp       # Send 0.001 ICP test deposit
pnpm run lib:test:btc       # Send 0.0001 ckBTC test deposit
```

---

## 11. Deployment Checklist

### Phase 1: Infrastructure Setup
- [ ] Install NPM dependencies (including `icsi-lib`)
- [ ] Update TypeScript configuration
- [ ] Add ICP to Blockchain enum
- [ ] Create ICP module and services
- [ ] Add environment variables to all environments
- [ ] Configure webhook URL in ICSI canister

### Phase 2: Core Implementation
- [ ] Implement IcpClientService
- [ ] Implement IcsiIndexerService
- [ ] Implement IcrcLedgerService
- [ ] Implement IcpWebhookController
- [ ] Write unit tests

### Phase 3: PayIn/PayOut Integration
- [ ] Implement IcpRegisterStrategy (webhook-based)
- [ ] Implement IcpPayoutStrategy
- [ ] Register strategies in respective modules
- [ ] Test webhook deposit detection
- [ ] Test payouts

### Phase 4: Database & Assets
- [ ] Run database migrations
- [ ] Add ICP/ckBTC/ckUSDC/ckUSDT assets
- [ ] Configure asset pricing sources

### Phase 5: VCHF/VEUR Integration
- [ ] **BLOCKER:** Wait for VNX canister deployment
- [ ] Add VCHF/VEUR canister IDs to config
- [ ] Register VCHF/VEUR in ICSI (if supported)
- [ ] Add VCHF/VEUR assets to database
- [ ] Test VCHF/VEUR transfers

### Phase 6: Production Deployment
- [ ] Security review of seed phrase handling
- [ ] Webhook endpoint security (rate limiting, validation)
- [ ] Monitoring setup for ICSI canister health
- [ ] Alerting for failed webhooks
- [ ] Documentation for operations team

---

## 12. Risk Assessment

### 12.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ICSI canister unavailable | High | Implement reconciliation cron job as fallback |
| Webhook endpoint unreachable | Medium | ICSI retries; manual reconciliation available |
| VCHF/VEUR not deployed yet | High | Blocker - coordinate with VNX |
| Seed phrase security | Critical | Use HSM or secure vault |

### 12.2 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ICSI polling interval too slow | Low | Configure 15s interval (costs ~2.24 ICP/month) |
| Webhook spam/DDoS | Medium | Rate limiting, tx_hash validation |
| ckBTC minting delays | Medium | Set user expectations (Bitcoin confirmations) |

---

## 13. Cost Estimation

### ICSI Canister Cycles

| Polling Interval | Monthly Cost (ICP) | Notes |
|------------------|-------------------|-------|
| 15 seconds | ~2.24 ICP | Aggressive, fastest detection |
| 30 seconds | ~1.12 ICP | Balanced |
| 60 seconds | ~0.56 ICP | Conservative |

**Recommendation:** Start with 30s interval, adjust based on volume.

---

## 14. Open Questions for Technical Integration Call

1. **VCHF/VEUR Deployment Timeline:**
   - When will VNX deploy VCHF/VEUR canisters on ICP?
   - Will ICSI support indexing custom ICRC-1 tokens?

2. **ICSI Customization:**
   - Can we deploy our own ICSI instance for full control?
   - Or should we use the public mainnet canister?

3. **Testnet Environment:**
   - Is there a testnet ICSI canister?
   - How to test VCHF/VEUR before mainnet?

4. **Webhook Security:**
   - Does ICSI support webhook authentication (secret header)?
   - How to verify webhook authenticity?

5. **ckBTC ↔ BTC:**
   - Minimum amounts for BTC → ckBTC minting?
   - Expected confirmation times?

---

## 15. References

- [ICSI GitHub Repository](https://github.com/garudaidr/icp-subaccount-indexer)
- [ICP JavaScript SDK Documentation](https://js.icp.build/)
- [ICRC-1 Token Standard](https://github.com/dfinity/ICRC-1)
- [ckBTC Documentation](https://docs.internetcomputer.org/defi/chain-key-tokens/ckbtc/overview)
- [ICRC API](https://icrc-api.internetcomputer.org/docs)
- [Principal vs Account ID](https://medium.com/plugwallet/internet-computer-ids-101-669b192a2ace)
- [VNX Official Website](https://vnx.li/)

---

*Document created: January 2026*
*Last updated: January 2026*
*Author: DFX Engineering Team*
