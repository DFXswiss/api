import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { PayInEntry } from '../../../interfaces';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(CitreaTestnetStrategy);

  private static readonly LAST_PROCESSED_BLOCK_KEY = 'citreaTestnetLastProcessedBlock';
  private lastProcessedBlock: number | null = null;

  @Inject() private readonly settingService: SettingService;

  constructor(private readonly citreaTestnetService: PayInCitreaTestnetService) {
    super();
  }

  onModuleInit() {
    super.onModuleInit();

    void this.loadPersistedState().catch((error) =>
      this.logger.error('Failed to load persisted state during initialization:', error),
    );
  }

  // --- JOBS --- //

  // Note: pay-in functionality currently not used/tested for Citrea
  // @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const { entries, processedBlock } = await this.getNewEntriesWithBlock();

    await this.createPayInsAndSave(entries, log);

    if (processedBlock !== null) await this.updateLastProcessedBlock(processedBlock);

    this.printInputLog(log, processedBlock ?? 'omitted', Blockchain.CITREA_TESTNET);
  }

  // --- HELPER METHODS --- //

  private async getNewEntriesWithBlock(): Promise<{ entries: PayInEntry[]; processedBlock: number | null }> {
    const currentBlock = await this.citreaTestnetService.getCurrentBlockNumber();
    const { fromBlock, toBlock } = this.getBlockRange(currentBlock);

    if (fromBlock > toBlock) {
      // no new blocks to process (could indicate blockchain reorganization)
      if (this.lastProcessedBlock !== null && currentBlock < this.lastProcessedBlock) {
        this.logger.warn(
          `Potential blockchain reorganization detected: currentBlock=${currentBlock} < lastProcessedBlock=${this.lastProcessedBlock}. ` +
            `This could indicate a chain fork. Will wait for chain to advance.`,
        );
      }
      return { entries: [], processedBlock: null };
    }

    this.logger.verbose(`Processing CitreaTestnet blocks ${fromBlock} to ${toBlock}`);

    const newEntries = await this.fetchTransactionsForBlockRange(fromBlock, toBlock);

    if (newEntries.length > 0) this.logger.info(`Found ${newEntries.length} new CitreaTestnet transactions`);

    return { entries: newEntries, processedBlock: toBlock };
  }

  private getBlockRange(currentBlock: number): { fromBlock: number; toBlock: number } {
    if (this.lastProcessedBlock == null) {
      const fromBlock = Math.max(0, currentBlock - 100);

      this.logger.warn(
        `First run: Starting from block ${fromBlock} (skipping blocks 0-${fromBlock - 1}). ` +
          `Historical transactions before block ${fromBlock} will not be processed.`,
      );

      return {
        fromBlock,
        toBlock: currentBlock,
      };
    }

    const maxBlocksPerRun = 100;
    const nextFromBlock = this.lastProcessedBlock + 1;
    const nextToBlock = Math.min(currentBlock, nextFromBlock + maxBlocksPerRun - 1);

    // warn about large gaps that might indicate service downtime
    if (nextToBlock - nextFromBlock + 1 >= maxBlocksPerRun) {
      this.logger.warn(
        `Processing maximum block range: ${nextFromBlock}-${nextToBlock} (${nextToBlock - nextFromBlock + 1} blocks)`,
      );
    }

    return {
      fromBlock: nextFromBlock,
      toBlock: nextToBlock,
    };
  }

  private async fetchTransactionsForBlockRange(fromBlock: number, toBlock: number): Promise<PayInEntry[]> {
    const allEntries: PayInEntry[] = [];
    const addressesToMonitor = await this.getPayInAddresses();

    for (const address of addressesToMonitor) {
      const [coinTransactions, tokenTransactions] = await this.citreaTestnetService.getHistory(
        address,
        fromBlock,
        toBlock,
      );

      const coinEntries = await this.mapCoinTransactionsToEntries(coinTransactions, address);
      allEntries.push(...coinEntries);

      const tokenEntries = await this.mapTokenTransactionsToEntries(tokenTransactions, address);
      allEntries.push(...tokenEntries);
    }

    return allEntries;
  }

  private async mapCoinTransactionsToEntries(
    transactions: EvmCoinHistoryEntry[],
    monitoredAddress: string,
  ): Promise<PayInEntry[]> {
    const asset = await this.assetService.getCitreaTestnetCoin();

    return transactions.map((tx) => ({
      senderAddresses: tx.from,
      receiverAddress: BlockchainAddress.create(tx.to, Blockchain.CITREA_TESTNET),
      txId: tx.hash,
      txType: this.getTxType(monitoredAddress),
      txSequence: 0, // EVM coin transactions have single output
      blockHeight: parseInt(tx.blockNumber),
      amount: parseFloat(tx.value),
      asset,
    }));
  }

  private async mapTokenTransactionsToEntries(
    transactions: EvmTokenHistoryEntry[],
    monitoredAddress: string,
  ): Promise<PayInEntry[]> {
    const entries: PayInEntry[] = [];

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    // group by transaction hash to handle multiple token transfers in same tx
    const txGroups = Util.groupBy(transactions, 'hash');

    for (const txGroup of txGroups.values()) {
      for (let i = 0; i < txGroup.length; i++) {
        const tx = txGroup[i];

        entries.push({
          senderAddresses: tx.from,
          receiverAddress: BlockchainAddress.create(tx.to, Blockchain.CITREA_TESTNET),
          txId: tx.hash,
          txType: this.getTxType(monitoredAddress),
          txSequence: i, // use index for multiple token transfers in same transaction
          blockHeight: parseInt(tx.blockNumber),
          amount: parseFloat(tx.value),
          asset: this.getTransactionAsset(supportedAssets, tx.contractAddress),
        });
      }
    }

    return entries;
  }

  private async loadPersistedState(): Promise<void> {
    const persistedBlock = await this.settingService.get(CitreaTestnetStrategy.LAST_PROCESSED_BLOCK_KEY);
    if (persistedBlock) this.lastProcessedBlock = +persistedBlock;
  }

  private async updateLastProcessedBlock(blockNumber: number): Promise<void> {
    await this.settingService.set(CitreaTestnetStrategy.LAST_PROCESSED_BLOCK_KEY, blockNumber.toString());
    this.lastProcessedBlock = blockNumber;
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  // --- HELPER METHODS --- //

  protected getOwnAddresses(): string[] {
    return [Config.blockchain.citreaTestnet.citreaTestnetWalletAddress];
  }
}
