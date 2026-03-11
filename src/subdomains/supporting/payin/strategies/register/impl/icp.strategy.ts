import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { IcpTransfer, IcpTransferQueryResult } from 'src/integration/blockchain/icp/dto/icp.dto';
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

const BATCH_SIZE = 2000;
const SETTING_KEY = 'icpLastScannedBlocks';

interface IcpScanState {
  [key: string]: number; // asset ID → last scanned block
}

interface ScanConfig {
  asset: Asset;
  label: string;
  scanState: IcpScanState;
  persistProgress: boolean;
  chainLength: number;
  fromBlock?: number;
  toBlock?: number;
  fetchFn: (cursor: number, count: number) => Promise<IcpTransferQueryResult>;
  matchFn: (transfer: IcpTransfer) => { address: string; txId: string } | undefined;
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

      const chainLength = toBlock ?? (await this.payInInternetComputerService.getBlockHeight());

      return await this.scanAndCollect({
        asset,
        label: 'ICP native',
        scanState,
        persistProgress,
        chainLength,
        fromBlock,
        toBlock,
        fetchFn: (cursor, count) => this.payInInternetComputerService.getTransfers(cursor, count),
        matchFn: (transfer) => {
          const principal = accountIdMap.get(transfer.to);
          return principal ? { address: principal, txId: transfer.blockIndex.toString() } : undefined;
        },
      });
    } catch (e) {
      this.logger.error('Failed to fetch native ICP transfers:', e);
      return [];
    }
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

        const decimals = asset.decimals;
        const chainLength = await this.payInInternetComputerService.getIcrcBlockHeight(canisterId);

        const newEntries = await this.scanAndCollect({
          asset,
          label: `ICRC ${asset.name}`,
          scanState,
          persistProgress,
          chainLength,
          fromBlock,
          toBlock,
          fetchFn: (cursor, count) =>
            this.payInInternetComputerService.getIcrcTransfers(canisterId, decimals, cursor, count),
          matchFn: (transfer) =>
            principalSet.has(transfer.to)
              ? { address: transfer.to, txId: `${canisterId}:${transfer.blockIndex}` }
              : undefined,
        });

        entries.push(...newEntries);
      } catch (e) {
        this.logger.error(`Failed to fetch ICRC transfers for ${asset.uniqueName ?? asset.name}:`, e);
      }
    }

    return entries;
  }

  // --- Scan with cold-start + persistence --- //
  private async scanAndCollect(config: ScanConfig): Promise<PayInEntry[]> {
    const { asset, label, scanState, persistProgress, chainLength, fromBlock, toBlock, fetchFn, matchFn } = config;
    const stateKey = asset.id.toString();
    const lastScanned = persistProgress ? scanState[stateKey] : undefined;

    // Cold start (no setting): scan last batch; explicit fromBlock or existing setting: resume from there
    const startBlock =
      fromBlock ?? (lastScanned === undefined ? Math.max(0, chainLength - BATCH_SIZE) : lastScanned + 1);
    const endBlock = toBlock ?? chainLength;
    if (startBlock >= endBlock) return [];

    const { newEntries, highestBlock } = await this.fetchTransfersBatched(
      asset,
      label,
      startBlock,
      endBlock,
      fetchFn,
      matchFn,
    );

    if (persistProgress && highestBlock > (lastScanned ?? 0)) {
      scanState[stateKey] = highestBlock;
    }

    return newEntries;
  }

  // --- Shared batched scan loop --- //
  private async fetchTransfersBatched(
    asset: Asset,
    label: string,
    startBlock: number,
    chainLength: number,
    fetchFn: (cursor: number, count: number) => Promise<IcpTransferQueryResult>,
    matchFn: (transfer: IcpTransfer) => { address: string; txId: string } | undefined,
  ): Promise<{ newEntries: PayInEntry[]; highestBlock: number }> {
    const newEntries: PayInEntry[] = [];
    let cursor = startBlock;
    let highestBlock = startBlock;

    while (cursor < chainLength) {
      const count = Math.min(BATCH_SIZE, chainLength - cursor);
      const result = await fetchFn(cursor, count);

      for (const transfer of result.transfers) {
        const match = matchFn(transfer);
        if (!match) continue;

        newEntries.push({
          senderAddresses: transfer.from,
          receiverAddress: BlockchainAddress.create(match.address, this.blockchain),
          txId: match.txId,
          txType: this.getTxType(match.address),
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
        this.logger.warn(`${label}: cursor stuck at ${cursor}, skipping to ${cursor + count}`);
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
