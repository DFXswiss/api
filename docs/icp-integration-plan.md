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
| Webhooks | Alchemy Webhooks | **Polling** (no native webhooks) |
| Transaction Finality | ~12 confirmations | **~2 seconds** |
| Gas Model | ETH for gas | **Cycles** (prepaid by canister) |

### 1.2 ICP Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DFX API Backend                          │
│                     (NestJS Application)                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    IcpClientService                             │
│              (New service using @dfinity/agent)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 API Boundary Nodes (Public)                     │
│            https://icp-api.io / https://icp0.io                 │
│               (No API keys, no rate limits*)                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌───────────┐      ┌───────────┐      ┌───────────┐
   │    ICP    │      │   ckBTC   │      │ VCHF/VEUR │
   │  Ledger   │      │  Ledger   │      │  Ledger   │
   │ Canister  │      │ Canister  │      │ Canister  │
   └───────────┘      └───────────┘      └───────────┘
         │                   │
         │            ┌──────┴──────┐
         │            ▼             ▼
         │      ┌──────────┐  ┌──────────┐
         │      │  ckBTC   │  │ Bitcoin  │
         │      │  Minter  │  │ Network  │
         │      │ Canister │  │ (Native) │
         │      └──────────┘  └──────────┘
         │
   Native ICP Token
```

### 1.3 Canister IDs (Production)

| Token | Ledger Canister ID | Minter Canister ID | Notes |
|-------|-------------------|-------------------|-------|
| ICP | `ryjl3-tyaaa-aaaaa-aaaba-cai` | - | Native token |
| ckBTC | `mxzaz-hqaaa-aaaar-qaada-cai` | `mqygn-kiaaa-aaaar-qaadq-cai` | Chain-key Bitcoin |
| VCHF | **TBD** | - | Pending VNX deployment |
| VEUR | **TBD** | - | Pending VNX deployment |

> **Action Required:** Request VCHF/VEUR canister IDs from VNX/DFINITY during technical integration call.

---

## 2. Required Dependencies

### 2.1 NPM Packages

```bash
# Core ICP Agent
npm install @dfinity/agent @dfinity/principal @dfinity/candid

# Identity Management (for wallet/signing)
npm install @dfinity/identity-secp256k1

# ICRC-1/2 Token Interaction (for ICP, ckBTC, VCHF, VEUR)
npm install @dfinity/ledger-icrc

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
│           │   ├── icp-ledger.service.ts          # ICP token operations
│           │   ├── ckbtc-ledger.service.ts        # ckBTC operations
│           │   ├── icrc-ledger.service.ts         # Generic ICRC-1/2 tokens
│           │   └── icp-address.service.ts         # Address generation
│           ├── dto/
│           │   ├── icp-transfer.dto.ts
│           │   └── icp-account.dto.ts
│           └── __tests__/
│               └── icp-client.service.spec.ts
│
├── subdomains/
│   └── supporting/
│       ├── payin/
│       │   └── strategies/
│       │       └── register/
│       │           └── impl/
│       │               └── icp.strategy.ts        # PayIn registration
│       └── payout/
│           └── strategies/
│               ├── prepare/
│               │   └── impl/
│               │       └── icp.strategy.ts        # Payout preparation
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

**File:** `src/integration/blockchain/shared/enums/blockchain.enum.ts`

Add `InternetComputer` to the blockchain registry.

---

## 4. Core Service Implementations

### 4.1 ICP Client Service

**File:** `src/integration/blockchain/icp/services/icp-client.service.ts`

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAgent, Identity } from '@dfinity/agent';
import { Secp256k1KeyIdentity } from '@dfinity/identity-secp256k1';
import { Principal } from '@dfinity/principal';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { Config } from 'src/config/config';

@Injectable()
export class IcpClientService implements OnModuleInit {
  private agent: HttpAgent;
  private identity: Secp256k1KeyIdentity;

  // Canister IDs (from config)
  private readonly ICP_LEDGER_CANISTER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
  private readonly CKBTC_LEDGER_CANISTER = 'mxzaz-hqaaa-aaaar-qaada-cai';
  private readonly CKBTC_MINTER_CANISTER = 'mqygn-kiaaa-aaaar-qaadq-cai';

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

  // Get our principal (wallet address equivalent)
  getPrincipal(): Principal {
    return this.identity.getPrincipal();
  }

  // Get the HTTP agent for canister calls
  getAgent(): HttpAgent {
    return this.agent;
  }

  // Create ledger canister instance for any ICRC-1 token
  createLedgerCanister(canisterId: string): IcrcLedgerCanister {
    return IcrcLedgerCanister.create({
      agent: this.agent,
      canisterId: Principal.fromText(canisterId),
    });
  }

  // Pre-configured ledger instances
  getIcpLedger(): IcrcLedgerCanister {
    return this.createLedgerCanister(this.ICP_LEDGER_CANISTER);
  }

  getCkBtcLedger(): IcrcLedgerCanister {
    return this.createLedgerCanister(this.CKBTC_LEDGER_CANISTER);
  }

  getVchfLedger(): IcrcLedgerCanister {
    return this.createLedgerCanister(Config.blockchain.icp.vchfCanisterId);
  }

  getVeurLedger(): IcrcLedgerCanister {
    return this.createLedgerCanister(Config.blockchain.icp.veurCanisterId);
  }
}
```

### 4.2 ICP Address Service

**File:** `src/integration/blockchain/icp/services/icp-address.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { AccountIdentifier, SubAccount } from '@dfinity/ledger-icp';
import { IcpClientService } from './icp-client.service';
import { createHash } from 'crypto';

@Injectable()
export class IcpAddressService {
  constructor(private readonly icpClient: IcpClientService) {}

  /**
   * ICP uses a different address model than EVM chains:
   * - Principal ID: The main identity (like a public key hash)
   * - Subaccount: A 32-byte blob to create multiple accounts under one principal
   * - Account Identifier: SHA224 hash of principal + subaccount
   *
   * For DFX, we use ONE master principal with unique subaccounts per user/deposit.
   */

  /**
   * Generate a unique deposit address for a user
   * @param uniqueIdentifier - Unique identifier for this deposit (e.g., route ID)
   * @returns Account identifier as hex string (64 characters)
   */
  generateDepositAddress(uniqueIdentifier: string): string {
    const masterPrincipal = this.icpClient.getPrincipal();

    // Create deterministic subaccount from unique identifier
    const subaccount = this.createSubaccountFromIdentifier(uniqueIdentifier);

    // Compute account identifier
    const accountId = AccountIdentifier.fromPrincipal({
      principal: masterPrincipal,
      subAccount: subaccount,
    });

    return accountId.toHex();
  }

  /**
   * Generate ICRC-1 account (Principal + Subaccount) for transfers
   */
  generateIcrcAccount(uniqueIdentifier: string): {
    owner: Principal;
    subaccount: Uint8Array;
  } {
    const masterPrincipal = this.icpClient.getPrincipal();
    const subaccount = this.createSubaccountFromIdentifier(uniqueIdentifier);

    return {
      owner: masterPrincipal,
      subaccount: subaccount.toUint8Array(),
    };
  }

  /**
   * Create a 32-byte subaccount from a unique identifier
   */
  private createSubaccountFromIdentifier(identifier: string): SubAccount {
    // Hash the identifier to get exactly 32 bytes
    const hash = createHash('sha256').update(identifier).digest();

    // SubAccount expects exactly 32 bytes
    return SubAccount.fromBytes(hash) as SubAccount;
  }

  /**
   * Derive account identifier from principal and subaccount
   * Following ICP spec: CRC32(h) || h where h = SHA224("\x0Aaccount-id" || principal || subaccount)
   */
  deriveAccountIdentifier(
    principal: Principal,
    subaccount?: Uint8Array,
  ): string {
    const sub = subaccount
      ? SubAccount.fromBytes(subaccount)
      : SubAccount.fromBytes(new Uint8Array(32));

    const accountId = AccountIdentifier.fromPrincipal({
      principal,
      subAccount: sub as SubAccount,
    });

    return accountId.toHex();
  }

  /**
   * Validate an ICP account identifier (64 hex characters with valid CRC32)
   */
  isValidAccountIdentifier(address: string): boolean {
    try {
      // Account identifiers are 64 hex characters (32 bytes)
      if (!/^[a-f0-9]{64}$/i.test(address)) {
        return false;
      }

      // Try to parse it (will throw if CRC32 is invalid)
      AccountIdentifier.fromHex(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate a Principal ID
   */
  isValidPrincipal(principal: string): boolean {
    try {
      Principal.fromText(principal);
      return true;
    } catch {
      return false;
    }
  }
}
```

### 4.3 ICRC Ledger Service (Generic Token Operations)

**File:** `src/integration/blockchain/icp/services/icrc-ledger.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { IcrcLedgerCanister } from '@dfinity/ledger-icrc';
import { IcpClientService } from './icp-client.service';
import { IcpAddressService } from './icp-address.service';

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
  constructor(
    private readonly icpClient: IcpClientService,
    private readonly addressService: IcpAddressService,
  ) {}

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
   * Get balance for our deposit address
   */
  async getDepositBalance(
    canisterId: string,
    depositIdentifier: string,
  ): Promise<bigint> {
    const account = this.addressService.generateIcrcAccount(depositIdentifier);
    return this.getBalance(canisterId, account.owner, account.subaccount);
  }

  /**
   * Transfer ICRC-1 tokens
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
   * Transfer from a deposit subaccount to external address
   */
  async transferFromDeposit(
    canisterId: string,
    depositIdentifier: string,
    toOwner: Principal,
    toSubaccount: Uint8Array | undefined,
    amount: bigint,
  ): Promise<IcrcTransferResult> {
    const fromAccount =
      this.addressService.generateIcrcAccount(depositIdentifier);

    return this.transfer({
      canisterId,
      to: {
        owner: toOwner,
        subaccount: toSubaccount,
      },
      amount,
      fromSubaccount: fromAccount.subaccount,
    });
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

    // Parse metadata array
    const metadataMap = new Map(metadata);

    return {
      symbol: this.extractTextMetadata(metadataMap, 'icrc1:symbol') || 'UNKNOWN',
      name: this.extractTextMetadata(metadataMap, 'icrc1:name') || 'Unknown Token',
      decimals: this.extractNatMetadata(metadataMap, 'icrc1:decimals') || 8,
      fee,
    };
  }

  /**
   * Get transaction history (for monitoring deposits)
   */
  async getTransactions(
    canisterId: string,
    start: bigint,
    length: number,
  ): Promise<any[]> {
    const ledger = this.icpClient.createLedgerCanister(canisterId);

    // Note: This uses ICRC-3 if available, otherwise falls back
    try {
      const result = await ledger.getTransactions({
        start,
        length: BigInt(length),
      });
      return result.transactions;
    } catch {
      // ICRC-3 not supported, return empty
      return [];
    }
  }

  private extractTextMetadata(
    metadata: Map<string, any>,
    key: string,
  ): string | undefined {
    const value = metadata.get(key);
    if (value && 'Text' in value) {
      return value.Text;
    }
    return undefined;
  }

  private extractNatMetadata(
    metadata: Map<string, any>,
    key: string,
  ): number | undefined {
    const value = metadata.get(key);
    if (value && 'Nat' in value) {
      return Number(value.Nat);
    }
    return undefined;
  }
}
```

### 4.4 ckBTC Service (Bitcoin Integration)

**File:** `src/integration/blockchain/icp/services/ckbtc.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Principal } from '@dfinity/principal';
import { CkBTCMinterCanister } from '@dfinity/ckbtc';
import { IcpClientService } from './icp-client.service';
import { IcrcLedgerService } from './icrc-ledger.service';

const CKBTC_MINTER_CANISTER_ID = 'mqygn-kiaaa-aaaar-qaadq-cai';
const CKBTC_LEDGER_CANISTER_ID = 'mxzaz-hqaaa-aaaar-qaada-cai';

@Injectable()
export class CkBtcService {
  private minter: CkBTCMinterCanister;

  constructor(
    private readonly icpClient: IcpClientService,
    private readonly icrcLedger: IcrcLedgerService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.minter = CkBTCMinterCanister.create({
      agent: this.icpClient.getAgent(),
      canisterId: Principal.fromText(CKBTC_MINTER_CANISTER_ID),
    });
  }

  /**
   * Get a Bitcoin deposit address for minting ckBTC
   * Each principal gets a unique BTC address
   */
  async getBitcoinDepositAddress(owner: Principal): Promise<string> {
    const address = await this.minter.getBtcAddress({
      owner: [owner],
      subaccount: [],
    });
    return address;
  }

  /**
   * Get Bitcoin deposit address for a specific subaccount
   */
  async getBitcoinDepositAddressForSubaccount(
    subaccount: Uint8Array,
  ): Promise<string> {
    const owner = this.icpClient.getPrincipal();
    const address = await this.minter.getBtcAddress({
      owner: [owner],
      subaccount: [subaccount],
    });
    return address;
  }

  /**
   * Update balance after BTC deposit (triggers minting)
   */
  async updateBalance(owner: Principal, subaccount?: Uint8Array): Promise<void> {
    await this.minter.updateBalance({
      owner: [owner],
      subaccount: subaccount ? [subaccount] : [],
    });
  }

  /**
   * Get ckBTC balance
   */
  async getBalance(owner: Principal, subaccount?: Uint8Array): Promise<bigint> {
    return this.icrcLedger.getBalance(CKBTC_LEDGER_CANISTER_ID, owner, subaccount);
  }

  /**
   * Retrieve real BTC (burn ckBTC and send to BTC address)
   */
  async retrieveBtc(
    btcAddress: string,
    amount: bigint,
  ): Promise<{ blockIndex: bigint }> {
    const result = await this.minter.retrieveBtcWithApproval({
      address: btcAddress,
      amount,
      fromSubaccount: [],
    });

    if ('Ok' in result) {
      return { blockIndex: result.Ok.block_index };
    }

    throw new Error(`Failed to retrieve BTC: ${JSON.stringify(result.Err)}`);
  }

  /**
   * Estimate withdrawal fee for retrieving BTC
   */
  async estimateWithdrawalFee(amount: bigint): Promise<bigint> {
    const params = await this.minter.estimateWithdrawalFee({ amount: [amount] });
    return params.minter_fee + params.bitcoin_fee;
  }

  /**
   * Get minter parameters (fees, minimum amounts, etc.)
   */
  async getMinterParams(): Promise<{
    minRetrieveAmount: bigint;
    minConfirmations: number;
  }> {
    const params = await this.minter.getMinterInfo();
    return {
      minRetrieveAmount: params.retrieve_btc_min_amount,
      minConfirmations: params.min_confirmations,
    };
  }
}
```

---

## 5. PayIn Strategy (Deposit Detection)

### 5.1 ICP Register Strategy

**File:** `src/subdomains/supporting/payin/strategies/register/impl/icp.strategy.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { RegisterStrategy } from '../register.strategy';
import { IcpClientService } from 'src/integration/blockchain/icp/services/icp-client.service';
import { IcrcLedgerService } from 'src/integration/blockchain/icp/services/icrc-ledger.service';
import { PayInService } from '../../payin.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';

/**
 * ICP PayIn Registration Strategy
 *
 * Key Differences from EVM:
 * - No webhooks available - must poll for deposits
 * - Uses ICRC-1 ledger for transaction history
 * - Account Identifiers instead of addresses
 * - Subaccounts for deposit isolation
 */
@Injectable()
export class IcpRegisterStrategy extends RegisterStrategy {
  private lastProcessedBlock: bigint = BigInt(0);

  constructor(
    private readonly icpClient: IcpClientService,
    private readonly icrcLedger: IcrcLedgerService,
    private readonly payInService: PayInService,
  ) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.InternetComputer;
  }

  /**
   * Poll for new deposits every 5 seconds
   * ICP has ~2 second finality, so this is sufficient
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  @Lock(1800)
  async checkPayInEntries(): Promise<void> {
    if (!this.isEnabled()) return;

    await this.checkDepositsForToken('ICP', this.getIcpLedgerCanisterId());
    await this.checkDepositsForToken('ckBTC', this.getCkBtcLedgerCanisterId());
    await this.checkDepositsForToken('VCHF', this.getVchfLedgerCanisterId());
    await this.checkDepositsForToken('VEUR', this.getVeurLedgerCanisterId());
  }

  private async checkDepositsForToken(
    tokenSymbol: string,
    canisterId: string,
  ): Promise<void> {
    if (!canisterId) return;

    try {
      // Get all active deposit routes for ICP blockchain
      const routes = await this.getActiveRoutes();

      for (const route of routes) {
        // Check balance for this route's deposit address
        const balance = await this.icrcLedger.getDepositBalance(
          canisterId,
          route.deposit.address, // Using address as unique identifier
        );

        // If balance > 0, process as deposit
        if (balance > BigInt(0)) {
          await this.processDeposit(route, tokenSymbol, canisterId, balance);
        }
      }
    } catch (error) {
      console.error(`Error checking ${tokenSymbol} deposits:`, error);
    }
  }

  private async processDeposit(
    route: any,
    tokenSymbol: string,
    canisterId: string,
    amount: bigint,
  ): Promise<void> {
    // Create PayIn entry
    const payIn = await this.payInService.createPayIn({
      address: route.deposit.address,
      txId: `icp-${canisterId}-${Date.now()}`, // Synthetic TX ID
      txSequence: 0,
      blockHeight: 0, // ICP doesn't have traditional blocks
      amount: Number(amount) / 1e8, // Convert from smallest unit
      asset: await this.getAssetBySymbol(tokenSymbol),
      route: route,
    });

    // Forward to liquidity pool
    await this.forwardToLiquidity(payIn, canisterId, amount);
  }

  private async forwardToLiquidity(
    payIn: any,
    canisterId: string,
    amount: bigint,
  ): Promise<void> {
    // Transfer from deposit subaccount to main liquidity account
    const result = await this.icrcLedger.transferFromDeposit(
      canisterId,
      payIn.address,
      this.icpClient.getPrincipal(), // To our main principal
      undefined, // Default subaccount (liquidity pool)
      amount,
    );

    if (result.success) {
      await this.payInService.updateForwardTx(payIn.id, result.blockIndex?.toString());
    }
  }

  // Canister ID getters (from config)
  private getIcpLedgerCanisterId(): string {
    return 'ryjl3-tyaaa-aaaaa-aaaba-cai';
  }

  private getCkBtcLedgerCanisterId(): string {
    return 'mxzaz-hqaaa-aaaar-qaada-cai';
  }

  private getVchfLedgerCanisterId(): string {
    // TODO: Get from config once VNX deploys
    return process.env.VCHF_ICP_CANISTER_ID || '';
  }

  private getVeurLedgerCanisterId(): string {
    // TODO: Get from config once VNX deploys
    return process.env.VEUR_ICP_CANISTER_ID || '';
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
import { IcpClientService } from 'src/integration/blockchain/icp/services/icp-client.service';
import { IcrcLedgerService } from 'src/integration/blockchain/icp/services/icrc-ledger.service';
import { CkBtcService } from 'src/integration/blockchain/icp/services/ckbtc.service';
import { Blockchain } from 'src/shared/enums/blockchain.enum';

@Injectable()
export class IcpPayoutStrategy extends PayoutStrategy {
  constructor(
    private readonly icpClient: IcpClientService,
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

    // Parse recipient address
    const { owner, subaccount } = this.parseIcpAddress(address);

    // Convert amount to smallest unit (8 decimals for ICP/ckBTC)
    const amountInSmallestUnit = BigInt(Math.floor(amount * 1e8));

    // Execute transfer
    const result = await this.icrcLedger.transfer({
      canisterId,
      to: { owner, subaccount },
      amount: amountInSmallestUnit,
    });

    if (!result.success) {
      throw new Error(`ICP payout failed: ${result.error}`);
    }

    // Return block index as TX ID
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

    // Convert fee to decimal (8 decimals)
    return Number(metadata.fee) / 1e8;
  }

  /**
   * Parse ICP address (can be Principal or Account Identifier)
   */
  private parseIcpAddress(address: string): {
    owner: Principal;
    subaccount?: Uint8Array;
  } {
    // Check if it's a Principal ID (contains dashes, ~63 chars)
    if (address.includes('-')) {
      return {
        owner: Principal.fromText(address),
        subaccount: undefined,
      };
    }

    // It's an Account Identifier (64 hex chars)
    // For Account Identifiers, we need the original Principal
    // This is a limitation - we can only send to Principals directly
    throw new Error(
      'Account Identifier addresses not supported for payout. Please provide Principal ID.',
    );
  }

  private getCanisterIdForAsset(assetName: string): string {
    const canisterMap: Record<string, string> = {
      ICP: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
      ckBTC: 'mxzaz-hqaaa-aaaar-qaada-cai',
      VCHF: process.env.VCHF_ICP_CANISTER_ID || '',
      VEUR: process.env.VEUR_ICP_CANISTER_ID || '',
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

Add to `.env` files:

```bash
# ICP Configuration
ICP_HOST=https://icp-api.io
ICP_SEED_PHRASE=your-24-word-seed-phrase-here

# Canister IDs (Mainnet)
ICP_LEDGER_CANISTER_ID=ryjl3-tyaaa-aaaaa-aaaba-cai
CKBTC_LEDGER_CANISTER_ID=mxzaz-hqaaa-aaaar-qaada-cai
CKBTC_MINTER_CANISTER_ID=mqygn-kiaaa-aaaar-qaadq-cai

# VNX Tokens (TBD - get from VNX)
VCHF_ICP_CANISTER_ID=
VEUR_ICP_CANISTER_ID=

# Testnet (for development)
ICP_TESTNET_HOST=https://icp-api.io  # ICP uses same API for testnet
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

      canisters: {
        icpLedger: process.env.ICP_LEDGER_CANISTER_ID || 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        ckbtcLedger: process.env.CKBTC_LEDGER_CANISTER_ID || 'mxzaz-hqaaa-aaaar-qaada-cai',
        ckbtcMinter: process.env.CKBTC_MINTER_CANISTER_ID || 'mqygn-kiaaa-aaaar-qaadq-cai',
        vchfLedger: process.env.VCHF_ICP_CANISTER_ID,
        veurLedger: process.env.VEUR_ICP_CANISTER_ID,
      },

      // Testnet canisters
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

## 9. Testing Strategy

### 9.1 Unit Tests

```typescript
// src/integration/blockchain/icp/__tests__/icp-client.service.spec.ts

describe('IcpClientService', () => {
  let service: IcpClientService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [IcpClientService],
    }).compile();

    service = module.get<IcpClientService>(IcpClientService);
  });

  it('should create agent with correct host', async () => {
    await service.onModuleInit();
    expect(service.getAgent()).toBeDefined();
  });

  it('should derive valid principal from seed', async () => {
    await service.onModuleInit();
    const principal = service.getPrincipal();
    expect(principal.toString()).toMatch(/^[a-z0-9-]+$/);
  });
});
```

### 9.2 Integration Tests (Testnet)

```typescript
describe('ICP Integration Tests', () => {
  it('should fetch ICP balance from testnet', async () => {
    const balance = await icrcLedger.getBalance(
      'ryjl3-tyaaa-aaaaa-aaaba-cai',
      Principal.fromText('aaaaa-aa'),
    );
    expect(typeof balance).toBe('bigint');
  });

  it('should generate valid deposit address', () => {
    const address = addressService.generateDepositAddress('test-route-123');
    expect(address).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

---

## 10. Deployment Checklist

### Phase 1: Infrastructure Setup
- [ ] Install NPM dependencies
- [ ] Update TypeScript configuration
- [ ] Add ICP to Blockchain enum
- [ ] Create ICP module and services
- [ ] Add environment variables to all environments

### Phase 2: Core Implementation
- [ ] Implement IcpClientService
- [ ] Implement IcpAddressService
- [ ] Implement IcrcLedgerService
- [ ] Implement CkBtcService
- [ ] Write unit tests

### Phase 3: PayIn/PayOut Integration
- [ ] Implement IcpRegisterStrategy
- [ ] Implement IcpPayoutStrategy
- [ ] Register strategies in respective modules
- [ ] Test deposit detection (polling)
- [ ] Test payouts

### Phase 4: Database & Assets
- [ ] Run database migrations
- [ ] Add ICP/ckBTC assets
- [ ] Configure asset pricing sources

### Phase 5: VCHF/VEUR Integration
- [ ] **BLOCKER:** Wait for VNX canister deployment
- [ ] Add VCHF/VEUR canister IDs to config
- [ ] Add VCHF/VEUR assets to database
- [ ] Test VCHF/VEUR transfers

### Phase 6: Production Deployment
- [ ] Security review of seed phrase handling
- [ ] Load testing for polling frequency
- [ ] Monitoring setup for ICP transactions
- [ ] Documentation for operations team

---

## 11. Risk Assessment

### 11.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| No webhooks for deposits | Medium | Implement efficient polling (every 5s) |
| VCHF/VEUR not deployed yet | High | Blocker - coordinate with VNX |
| ICP API rate limits | Low | Public API has generous limits |
| Seed phrase security | Critical | Use HSM or secure vault |

### 11.2 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| ICP network downtime | Medium | Implement retry logic, fallback to manual |
| ckBTC minting delays | Medium | Set user expectations (Bitcoin confirmations) |
| Canister upgrades | Low | Monitor DFINITY announcements |

---

## 12. Open Questions for Technical Integration Call

1. **VCHF/VEUR Deployment Timeline:**
   - When will VNX deploy VCHF/VEUR canisters on ICP?
   - What will be the canister IDs?

2. **Testnet Environment:**
   - Is there a testnet version of VCHF/VEUR for development?
   - Should we use Bitcoin Testnet4 for ckBTC testing?

3. **Address Format:**
   - Do users need to provide Principal IDs or Account Identifiers?
   - How should we handle subaccounts for user deposits?

4. **Compliance:**
   - Are there any ICP-specific KYC/AML requirements?
   - How does DFINITY handle travel rule compliance?

5. **Pricing:**
   - What price feed should we use for ICP, ckBTC?
   - Will VNX provide price feeds for VCHF/VEUR on ICP?

---

## 13. References

- [ICP JavaScript SDK Documentation](https://js.icp.build/)
- [ICRC-1 Token Standard](https://github.com/dfinity/ICRC-1)
- [ckBTC Documentation](https://docs.internetcomputer.org/defi/chain-key-tokens/ckbtc/overview)
- [ICP Ledger Usage](https://docs.internetcomputer.org/defi/token-ledgers/usage/icrc1_ledger_usage)
- [Principal vs Account ID](https://medium.com/plugwallet/internet-computer-ids-101-669b192a2ace)
- [VNX Official Website](https://vnx.li/)

---

*Document created: January 2026*
*Last updated: January 2026*
*Author: DFX Engineering Team*
