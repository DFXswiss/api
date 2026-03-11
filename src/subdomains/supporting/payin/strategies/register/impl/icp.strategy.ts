import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { InternetComputerUtil } from 'src/integration/blockchain/icp/icp.util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInInternetComputerService } from '../../../services/payin-icp.service';
import { RegisterStrategy } from './base/register.strategy';

const NATIVE_BATCH_SIZE = 2000;
const ICRC_BATCH_SIZE = 2000;
const SETTING_KEY = 'icpLastScannedBlocks';

interface IcpScanState {
  [key: string]: number; // asset ID → last scanned block
}

@Injectable()
export class InternetComputerStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(InternetComputerStrategy);

  private readonly paymentAddress: string;

  constructor(
    private readonly payInInternetComputerService: PayInInternetComputerService,
    private readonly depositService: DepositService,
    private readonly settingService: SettingService,
  ) {
    super();

    const wallet = InternetComputerUtil.createWallet({ seed: Config.payment.internetComputerSeed, index: 0 });
    this.paymentAddress = wallet.address;
  }

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    const allDeposits = await this.depositService.getUsedDepositsByBlockchain(this.blockchain);
    const allDepositAddresses = allDeposits.map((d) => d.address);

    if (this.paymentAddress && !allDepositAddresses.includes(this.paymentAddress)) {
      allDepositAddresses.push(this.paymentAddress);
    }

    await this.processNewPayInEntries(allDepositAddresses, true);
  }

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress.address], false, fromBlock, toBlock);
  }

  //*** HELPER METHODS ***//
  private async processNewPayInEntries(
    depositAddresses: string[],
    persistProgress: boolean,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<void> {
    const log = this.createNewLogObject();

    const scanState = persistProgress ? await this.getScanState() : {};

    const nativeEntries = await this.getNativeEntries(depositAddresses, scanState, persistProgress, fromBlock, toBlock);
    const icrcEntries = await this.getIcrcTokenEntries(
      depositAddresses,
      scanState,
      persistProgress,
      fromBlock,
      toBlock,
    );

    const newEntries = [...nativeEntries, ...icrcEntries];

    if (newEntries.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    if (persistProgress) {
      await this.saveScanState(scanState);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  // --- Native ICP (global query_blocks scan) --- //
  private async getNativeEntries(
    depositAddresses: string[],
    scanState: IcpScanState,
    persistProgress: boolean,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    try {
      const asset = await this.assetService.getNativeAsset(this.blockchain);

      // Build AccountIdentifier → Principal map
      const accountIdMap = new Map<string, string>();
      for (const principal of depositAddresses) {
        const accountId = InternetComputerUtil.accountIdentifier(principal);
        accountIdMap.set(accountId, principal);
      }

      const stateKey = asset.id.toString();
      const chainLength = toBlock ?? (await this.payInInternetComputerService.getBlockHeight());
      const lastScanned = persistProgress ? scanState[stateKey] : undefined;

      // Cold start (no setting): scan last batch; explicit fromBlock or existing setting: resume from there
      const startBlock =
        fromBlock ?? (lastScanned === undefined ? Math.max(0, chainLength - NATIVE_BATCH_SIZE) : lastScanned + 1);
      if (startBlock >= chainLength) return [];

      const { newEntries, highestBlock } = await this.fetchNativeTransfersBatched(
        asset,
        startBlock,
        chainLength,
        accountIdMap,
      );

      if (persistProgress && highestBlock > (lastScanned ?? 0)) {
        scanState[stateKey] = highestBlock;
      }

      return newEntries;
    } catch (e) {
      this.logger.error('Failed to fetch native ICP transfers:', e);
      return [];
    }
  }

  private async fetchNativeTransfersBatched(
    asset: Asset,
    startBlock: number,
    chainLength: number,
    accountIdMap: Map<string, string>,
  ): Promise<{ newEntries: PayInEntry[]; highestBlock: number }> {
    const newEntries: PayInEntry[] = [];
    let cursor = startBlock;
    let highestBlock = startBlock;

    while (cursor < chainLength) {
      const count = Math.min(NATIVE_BATCH_SIZE, chainLength - cursor);
      const result = await this.payInInternetComputerService.getTransfers(cursor, count);

      for (const transfer of result.transfers) {
        const matchedPrincipal = accountIdMap.get(transfer.to);
        if (!matchedPrincipal) continue;

        newEntries.push({
          senderAddresses: transfer.from,
          receiverAddress: BlockchainAddress.create(matchedPrincipal, this.blockchain),
          txId: transfer.blockIndex.toString(),
          txType: this.getTxType(matchedPrincipal),
          blockHeight: transfer.blockIndex,
          amount: transfer.amount,
          asset,
        });
      }

      if (result.lastBlockIndex > highestBlock) {
        highestBlock = result.lastBlockIndex;
      }

      const nextCursor = result.lastBlockIndex + 1;

      if (nextCursor <= cursor) {
        this.logger.warn(`ICP native: cursor stuck at ${cursor}, skipping to ${cursor + count}`);
        cursor += count;
      } else {
        cursor = nextCursor;
      }

      if (result.rawTransactionCount === 0) break;
    }

    return { newEntries, highestBlock };
  }

  // --- ICRC token transfers (global ledger, filtered client-side) --- //
  private async getIcrcTokenEntries(
    depositAddresses: string[],
    scanState: IcpScanState,
    persistProgress: boolean,
    fromBlock?: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const tokenAssets = await this.assetService.getTokens(this.blockchain);
    if (!tokenAssets.length) return [];

    const principalSet = new Set(depositAddresses);
    const entries: PayInEntry[] = [];

    for (const asset of tokenAssets) {
      try {
        const canisterId = asset.chainId;
        if (!canisterId) continue;

        if (!asset.decimals) {
          this.logger.error(`Asset ${asset.name} has no decimals configured, skipping`);
          continue;
        }

        const stateKey = asset.id.toString();
        const decimals = asset.decimals;
        const chainLength = await this.payInInternetComputerService.getIcrcBlockHeight(canisterId);
        const lastScanned = persistProgress ? scanState[stateKey] : undefined;

        // Cold start (no setting): scan last batch; explicit fromBlock or existing setting: resume from there
        const startBlock =
          fromBlock ?? (lastScanned === undefined ? Math.max(0, chainLength - ICRC_BATCH_SIZE) : lastScanned + 1);
        const endBlock = toBlock ?? chainLength;
        if (startBlock >= endBlock) continue;

        const { newEntries, highestBlock } = await this.fetchIcrcTransfersBatched(
          asset,
          canisterId,
          decimals,
          startBlock,
          endBlock,
          principalSet,
        );

        entries.push(...newEntries);

        if (persistProgress && highestBlock > (lastScanned ?? 0)) {
          scanState[stateKey] = highestBlock;
        }
      } catch (e) {
        this.logger.error(`Failed to fetch ICRC transfers for ${asset.uniqueName ?? asset.name}:`, e);
      }
    }

    return entries;
  }

  private async fetchIcrcTransfersBatched(
    asset: Asset,
    canisterId: string,
    decimals: number,
    startBlock: number,
    chainLength: number,
    principalSet: Set<string>,
  ): Promise<{ newEntries: PayInEntry[]; highestBlock: number }> {
    const newEntries: PayInEntry[] = [];
    let cursor = startBlock;
    let highestBlock = startBlock;

    while (cursor < chainLength) {
      const count = Math.min(ICRC_BATCH_SIZE, chainLength - cursor);
      const result = await this.payInInternetComputerService.getIcrcTransfers(canisterId, decimals, cursor, count);

      for (const transfer of result.transfers) {
        if (!principalSet.has(transfer.to)) continue;

        newEntries.push({
          senderAddresses: transfer.from,
          receiverAddress: BlockchainAddress.create(transfer.to, this.blockchain),
          txId: `${canisterId}:${transfer.blockIndex}`,
          txType: this.getTxType(transfer.to),
          blockHeight: transfer.blockIndex,
          amount: transfer.amount,
          asset,
        });
      }

      if (result.lastBlockIndex > highestBlock) {
        highestBlock = result.lastBlockIndex;
      }

      const nextCursor = result.lastBlockIndex + 1;

      if (nextCursor <= cursor) {
        this.logger.warn(`ICRC ${asset.name}: cursor stuck at ${cursor}, skipping to ${cursor + count}`);
        cursor += count;
      } else {
        cursor = nextCursor;
      }

      if (result.rawTransactionCount === 0) break;
    }

    return { newEntries, highestBlock };
  }

  // --- Settings-based block height persistence --- //
  private async getScanState(): Promise<IcpScanState> {
    return (await this.settingService.getObj<IcpScanState>(SETTING_KEY)) ?? {};
  }

  private async saveScanState(state: IcpScanState): Promise<void> {
    await this.settingService.setObj<IcpScanState>(SETTING_KEY, state);
  }

  private getTxType(resolvedAddress: string): PayInType {
    return resolvedAddress === this.paymentAddress ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
