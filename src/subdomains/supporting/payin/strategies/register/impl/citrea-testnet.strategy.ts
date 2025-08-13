import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { PayInEntry } from '../../../interfaces';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { PayInType } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Util } from 'src/shared/utils/util';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(CitreaTestnetStrategy);
  
  private static readonly LAST_PROCESSED_BLOCK_KEY = 'citreaTestnetLastProcessedBlock';
  private lastProcessedBlock: number | null = null;
  private readonly processedTransactions = new Set<string>(); // For deduplication
  private readonly MAX_PROCESSED_TRANSACTIONS = 10000; // Prevent memory leaks
  private isProcessing = false; // Lock to prevent concurrent runs

  @Inject() private readonly settingService: SettingService;

  constructor(
    private readonly citreaTestnetService: PayInCitreaTestnetService,
  ) {
    super(citreaTestnetService);
  }

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();
    this.assetTransfersMessageQueue = new QueueHandler();

    // Load persistent state from database asynchronously
    this.loadPersistedState().catch(error => 
      this.logger.error('Failed to load persisted state during initialization:', error)
    );

    // CitreaTestnet uses Goldsky for transaction monitoring via polling
    // Cron-based checking every 30 seconds with state management and deduplication
  }

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_30_SECONDS, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    if (this.isProcessing) {
      this.logger.verbose('Previous CitreaTestnet processing still running, skipping this iteration');
      return;
    }
    
    this.isProcessing = true;
    try {
      await this.processNewPayInEntries();
    } finally {
      this.isProcessing = false;
    }
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const { entries, processedBlock } = await this.getNewEntriesWithBlock();

    // Only update processed block AFTER successful transaction processing
    await this.createPayInsAndSave(entries, log);
    
    // Success! Now mark transactions as processed and update block
    this.markTransactionsAsProcessed(entries);
    
    if (processedBlock !== null) {
      await this.updateLastProcessedBlock(processedBlock);
    }

    this.printInputLog(log, 'omitted', Blockchain.CITREA_TESTNET);
  }

  private async getNewEntriesWithBlock(): Promise<{ entries: PayInEntry[]; processedBlock: number | null }> {
    try {
      // Get current block number
      const currentBlock = await this.getCurrentBlock();
      
      // Determine block range to process
      const { fromBlock, toBlock } = this.getBlockRange(currentBlock);
      
      if (fromBlock > toBlock) {
        // No new blocks to process (could indicate blockchain reorganization)
        if (this.lastProcessedBlock !== null && currentBlock < this.lastProcessedBlock) {
          this.logger.warn(
            `Potential blockchain reorganization detected: currentBlock=${currentBlock} < lastProcessedBlock=${this.lastProcessedBlock}. ` +
            `This could indicate a chain fork. Will wait for chain to advance.`
          );
        }
        return { entries: [], processedBlock: null };
      }
      
      this.logger.verbose(`Processing CitreaTestnet blocks ${fromBlock} to ${toBlock}`);
      
      // Get all transactions for monitored addresses
      const allEntries = await this.fetchTransactionsForBlockRange(fromBlock, toBlock);
      
      // Filter out duplicates
      const newEntries = this.filterDuplicateTransactions(allEntries);
      
      if (newEntries.length > 0) {
        this.logger.info(`Found ${newEntries.length} new CitreaTestnet transactions`);
      }
      
      // Return entries and the block number to process AFTER successful save
      return { entries: newEntries, processedBlock: toBlock };
    } catch (error) {
      // Error logging is done by @DfxCron
      return { entries: [], processedBlock: null };
    }
  }
  
  private getBlockRange(currentBlock: number): { fromBlock: number; toBlock: number } {
    if (this.lastProcessedBlock === null) {
      // First run - start from recent blocks to avoid processing entire history
      const blocksToLookBack = 100; // Look back 100 blocks on first run for better coverage
      const fromBlock = Math.max(0, currentBlock - blocksToLookBack);
      
      this.logger.warn(
        `First run: Starting from block ${fromBlock} (skipping blocks 0-${fromBlock - 1}). ` +
        `Historical transactions before block ${fromBlock} will not be processed.`
      );
      
      return {
        fromBlock,
        toBlock: currentBlock
      };
    }
    
    // Prevent processing too many blocks at once to avoid timeouts and rate limiting
    const maxBlocksPerRun = 100;
    const nextFromBlock = this.lastProcessedBlock + 1;
    const nextToBlock = Math.min(currentBlock, nextFromBlock + maxBlocksPerRun - 1);
    
    // Warn about large gaps that might indicate service downtime
    if (nextToBlock - nextFromBlock + 1 >= maxBlocksPerRun) {
      this.logger.warn(`Processing maximum block range: ${nextFromBlock}-${nextToBlock} (${nextToBlock - nextFromBlock + 1} blocks). Consider investigating service downtime.`);
    }
    
    return {
      fromBlock: nextFromBlock,
      toBlock: nextToBlock
    };
  }
  
  private async fetchTransactionsForBlockRange(fromBlock: number, toBlock: number): Promise<PayInEntry[]> {
    const allEntries: PayInEntry[] = [];
    const addressesToMonitor = this.getOwnAddresses();
    
    // Process all addresses in a single batch for better performance
    for (const address of addressesToMonitor) {
      try {
        const [coinTransactions, tokenTransactions] = await this.citreaTestnetService.getHistory(
          address,
          fromBlock,
          toBlock
        );
        
        // Convert coin transactions
        const coinEntries = await this.mapCoinTransactionsToEntries(coinTransactions, address);
        allEntries.push(...coinEntries);
        
        // Convert token transactions
        const tokenEntries = await this.mapTokenTransactionsToEntries(tokenTransactions, address);
        allEntries.push(...tokenEntries);
        
      } catch (error) {
        this.logger.warn(`Failed to fetch transactions for address ${address}:`, error);
      }
    }
    
    return allEntries;
  }
  
  private filterDuplicateTransactions(entries: PayInEntry[]): PayInEntry[] {
    // Only filter, don't mark as processed yet (that happens after successful save)
    return entries.filter(entry => {
      const txKey = `${entry.txId}-${entry.txSequence}`;
      return !this.processedTransactions.has(txKey);
    });
  }
  
  private markTransactionsAsProcessed(entries: PayInEntry[]): void {
    entries.forEach(entry => {
      const txKey = `${entry.txId}-${entry.txSequence}`;
      this.processedTransactions.add(txKey);
    });
    
    // Prevent memory leaks by clearing old transactions
    if (this.processedTransactions.size > this.MAX_PROCESSED_TRANSACTIONS) {
      this.logger.verbose('Clearing processed transactions cache to prevent memory leaks');
      this.processedTransactions.clear();
    }
  }
  
  private async getCurrentBlock(): Promise<number> {
    return this.citreaTestnetService.getCurrentBlockNumber();
  }
  
  private async mapCoinTransactionsToEntries(transactions: EvmCoinHistoryEntry[], monitoredAddress: string): Promise<PayInEntry[]> {
    const asset = await this.assetService.getCitreaTestnetCoin();
    
    return transactions.map((tx) => ({
      senderAddresses: tx.from,
      receiverAddress: BlockchainAddress.create(tx.to, Blockchain.CITREA_TESTNET),
      txId: tx.hash,
      txType: this.determineTxType(monitoredAddress),
      txSequence: 0, // EVM coin transactions have single output
      blockHeight: parseInt(tx.blockNumber),
      amount: parseFloat(tx.value),
      asset,
    }));
  }
  
  private async mapTokenTransactionsToEntries(transactions: EvmTokenHistoryEntry[], monitoredAddress: string): Promise<PayInEntry[]> {
    const entries: PayInEntry[] = [];
    
    // Group by transaction hash to handle multiple token transfers in same tx
    const txGroups = new Map<string, EvmTokenHistoryEntry[]>();
    transactions.forEach(tx => {
      const existing = txGroups.get(tx.hash) || [];
      existing.push(tx);
      txGroups.set(tx.hash, existing);
    });
    
    for (const [_txHash, txGroup] of txGroups) {
      for (let i = 0; i < txGroup.length; i++) {
        const tx = txGroup[i];
        try {
          // Get the asset for this token by contract address
          const asset = await this.assetService.getAssetByChainId(Blockchain.CITREA_TESTNET, tx.contractAddress);
          
          entries.push({
            senderAddresses: tx.from,
            receiverAddress: BlockchainAddress.create(tx.to, Blockchain.CITREA_TESTNET),
            txId: tx.hash,
            txType: this.determineTxType(monitoredAddress),
            txSequence: i, // Use index for multiple token transfers in same transaction
            blockHeight: parseInt(tx.blockNumber),
            amount: parseFloat(tx.value),
            asset,
          });
        } catch (error) {
          this.logger.error(`Failed to map token transaction ${tx.hash} (sequence ${i}):`, error);
          // Don't add to entries on error, but continue processing others
        }
      }
    }
    
    return entries;
  }
  
  private determineTxType(monitoredAddress: string): PayInType | undefined {
    // Determine if this is a payment or deposit based on the address
    return Util.equalsIgnoreCase(Config.payment.citreaTestnetAddress, monitoredAddress) 
      ? PayInType.PAYMENT 
      : PayInType.DEPOSIT;
  }
  
  private async loadPersistedState(): Promise<void> {
    try {
      const persistedBlock = await this.settingService.get(CitreaTestnetStrategy.LAST_PROCESSED_BLOCK_KEY);
      if (persistedBlock) {
        this.lastProcessedBlock = parseInt(persistedBlock, 10);
        this.logger.info(`Loaded persisted state: lastProcessedBlock = ${this.lastProcessedBlock}`);
      }
    } catch (error) {
      this.logger.warn('Failed to load persisted state, starting fresh:', error);
    }
  }
  
  private async updateLastProcessedBlock(blockNumber: number): Promise<void> {
    try {
      // First persist to database
      await this.settingService.set(CitreaTestnetStrategy.LAST_PROCESSED_BLOCK_KEY, blockNumber.toString());
      // Only update in-memory state after successful persistence
      this.lastProcessedBlock = blockNumber;
    } catch (error) {
      this.logger.error('Failed to update last processed block:', error);
      // Don't update in-memory state if DB update failed
      throw error;
    }
  }
  
  private async persistState(): Promise<void> {
    try {
      if (this.lastProcessedBlock !== null) {
        await this.settingService.set(CitreaTestnetStrategy.LAST_PROCESSED_BLOCK_KEY, this.lastProcessedBlock.toString());
      }
    } catch (error) {
      this.logger.warn('Failed to persist state:', error);
    }
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [
      Config.blockchain.citreaTestnet.citreaTestnetWalletAddress,
      Config.payment.citreaTestnetAddress
    ];
  }
}