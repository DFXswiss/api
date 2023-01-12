import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { DepositRouteRepository } from 'src/mix/models/route/deposit-route.repository';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { getCustomRepository } from 'typeorm';
import { PayInFactory } from '../../factories/payin.factory';
import { PayInEntry } from '../../interfaces';
import { PayInRepository } from '../../repositories/payin.repository';
import { PayInEvmService } from '../../services/payin-evm.service';
import { PayInStrategy } from './payin.strategy';

export abstract class EvmStrategy extends PayInStrategy {
  constructor(
    protected readonly blockchain: Blockchain,
    protected readonly nativeCoin: string,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
    protected readonly assetService: AssetService,
  ) {
    super();
  }

  protected async processNewPayInEntries(): Promise<void> {
    const addresses: string[] = await this.getPayInAddresses();
    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    await this.getTransactionsAndCreatePayIns(addresses, lastCheckedBlockHeight);
  }

  //*** HELPER METHODS ***//

  private async getPayInAddresses(): Promise<string[]> {
    const routes = await getCustomRepository(DepositRouteRepository).find({
      deposit: { blockchain: this.blockchain },
    });

    return routes.map((dr) => dr.deposit.address);
  }

  private async getLastCheckedBlockHeight(): Promise<number> {
    return this.payInRepository
      .findOne({ where: { address: { blockchain: this.blockchain } }, order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getTransactionsAndCreatePayIns(addresses: string[], blockHeight: number): Promise<void> {
    const supportedAssets = await this.assetService.getAllAsset([this.blockchain]);

    for (const address of addresses) {
      const [coinHistory, tokenHistory] = await this.payInEvmService.getHistory(address, blockHeight);
      const entries = this.mapHistoryToPayInEntries(address, coinHistory, tokenHistory, supportedAssets);

      await this.verifyLastBlockEntries(address, entries, blockHeight);
      await this.processNewEntries(entries, blockHeight);
    }
  }

  private mapHistoryToPayInEntries(
    address: string,
    coinHistory: EvmCoinHistoryEntry[],
    tokenHistory: EvmTokenHistoryEntry[],
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const relevantCoinEntries = this.filterEntriesByReceiverAddress(address, coinHistory);
    const relevantTokenEntries = this.filterEntriesByReceiverAddress(address, tokenHistory);

    return [
      ...this.mapCoinEntries(relevantCoinEntries, supportedAssets),
      ...this.mapTokenEntries(relevantTokenEntries, supportedAssets),
    ];
  }

  private filterEntriesByReceiverAddress<T extends EvmCoinHistoryEntry | EvmTokenHistoryEntry>(
    address: string,
    transactions: T[],
  ): T[] {
    return transactions.filter((tx) => tx.to === address);
  }

  private mapCoinEntries(coinTransactions: EvmCoinHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return coinTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.convertToEthLikeDenomination(parseFloat(tx.value)),
      asset: this.assetService.getByNameSync(supportedAssets, this.nativeCoin, this.blockchain) ?? null,
    }));
  }

  private mapTokenEntries(tokenTransactions: EvmTokenHistoryEntry[], supportedAssets: Asset[]): PayInEntry[] {
    return tokenTransactions.map((tx) => ({
      address: BlockchainAddress.create(tx.to, this.blockchain),
      txId: tx.hash,
      blockHeight: parseInt(tx.blockNumber),
      amount: this.payInEvmService.convertToEthLikeDenomination(parseFloat(tx.value), parseInt(tx.tokenDecimal)),
      asset: this.assetService.getByNameSync(supportedAssets, tx.tokenSymbol, this.blockchain) ?? null,
    }));
  }

  private async verifyLastBlockEntries(address: string, allTransactions: PayInEntry[], blockHeight: number) {
    const transactionsFromLastRecordedBlock = allTransactions.filter((t) => t.blockHeight === blockHeight);

    if (transactionsFromLastRecordedBlock.length === 0) return;

    await this.checkIfAllEntriesRecorded(address, transactionsFromLastRecordedBlock, blockHeight);
  }

  private async checkIfAllEntriesRecorded(
    address: string,
    transactions: PayInEntry[],
    blockHeight: number,
  ): Promise<void> {
    const recordedLastBlockPayIns = await this.payInRepository.find({
      address: { address, blockchain: this.blockchain },
      blockHeight,
    });

    for (const tx of transactions) {
      !recordedLastBlockPayIns.find((p) => p.txId === tx.txId) && (await this.createPayIn(tx));
    }
  }

  private async processNewEntries(allTransactions: PayInEntry[], blockHeight: number) {
    const newTransactions = allTransactions.filter((t) => t.blockHeight > blockHeight);

    for (const tx of newTransactions) {
      await this.createPayIn(tx);
    }
  }

  private async createPayIn(transaction: PayInEntry): Promise<void> {
    const payIn = this.payInFactory.createFromTransaction(transaction);
    await this.payInRepository.save(payIn);
  }
}
