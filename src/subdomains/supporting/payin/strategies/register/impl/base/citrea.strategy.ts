import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { PayInType } from '../../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../../interfaces';
import { RegisterStrategy } from './register.strategy';

export interface PayInCitreaServiceInterface {
  getHistory(address: string, fromBlock: number): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]>;
}

export abstract class CitreaBaseStrategy extends RegisterStrategy {
  protected readonly logger = new DfxLogger(CitreaBaseStrategy);

  private readonly paymentDepositAddress: string;

  protected abstract getOwnAddresses(): string[];

  constructor(
    protected readonly payInCitreaService: PayInCitreaServiceInterface,
    protected readonly transactionRequestService: TransactionRequestService,
  ) {
    super();
    this.paymentDepositAddress = EvmUtil.createWallet({ seed: Config.payment.evmSeed, index: 0 }).address;
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    const activeDepositAddresses = await this.transactionRequestService.getActiveDepositAddresses(
      Util.hoursBefore(1),
      this.blockchain,
    );

    await this.processNewPayInEntries(activeDepositAddresses.map((a) => BlockchainAddress.create(a, this.blockchain)));
  }

  async pollAddress(depositAddress: BlockchainAddress): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress]);
  }

  private async processNewPayInEntries(depositAddresses: BlockchainAddress[]): Promise<void> {
    const log = this.createNewLogObject();

    const newEntries: PayInEntry[] = [];

    for (const depositAddress of depositAddresses) {
      const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight(depositAddress);

      newEntries.push(...(await this.getNewEntries(depositAddress, lastCheckedBlockHeight)));
    }

    if (newEntries?.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getLastCheckedBlockHeight(depositAddress: BlockchainAddress): Promise<number> {
    return this.payInRepository
      .findOne({
        select: ['id', 'blockHeight'],
        where: { address: depositAddress },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getNewEntries(
    depositAddress: BlockchainAddress,
    lastCheckedBlockHeight: number,
  ): Promise<PayInEntry[]> {
    const fromBlock = lastCheckedBlockHeight + 1;
    const [coinTransactions, tokenTransactions] = await this.payInCitreaService.getHistory(
      depositAddress.address,
      fromBlock,
    );

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const coinEntries = this.mapCoinTransactionsToEntries(coinTransactions, depositAddress, supportedAssets);
    const tokenEntries = this.mapTokenTransactionsToEntries(tokenTransactions, depositAddress, supportedAssets);

    return [...coinEntries, ...tokenEntries];
  }

  private mapCoinTransactionsToEntries(
    transactions: EvmCoinHistoryEntry[],
    depositAddress: BlockchainAddress,
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const ownAddresses = this.getOwnAddresses();
    const relevantTransactions = transactions.filter(
      (t) =>
        t.to.toLowerCase() === depositAddress.address.toLowerCase() &&
        !Util.includesIgnoreCase(ownAddresses, t.from),
    );

    const coinAsset = supportedAssets.find((a) => a.type === AssetType.COIN);

    return relevantTransactions.map((tx) => ({
      senderAddresses: tx.from,
      receiverAddress: depositAddress,
      txId: tx.hash,
      txType: this.getTxType(depositAddress.address),
      txSequence: 0,
      blockHeight: parseInt(tx.blockNumber),
      amount: Util.floorByPrecision(EvmUtil.fromWeiAmount(tx.value), 15),
      asset: coinAsset,
    }));
  }

  private mapTokenTransactionsToEntries(
    transactions: EvmTokenHistoryEntry[],
    depositAddress: BlockchainAddress,
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const ownAddresses = this.getOwnAddresses();
    const relevantTransactions = transactions.filter(
      (t) =>
        t.to.toLowerCase() === depositAddress.address.toLowerCase() &&
        !Util.includesIgnoreCase(ownAddresses, t.from),
    );

    const entries: PayInEntry[] = [];
    const txGroups = Util.groupBy(relevantTransactions, 'hash');

    for (const txGroup of txGroups.values()) {
      for (let i = 0; i < txGroup.length; i++) {
        const tx = txGroup[i];

        const asset = this.assetService.getByChainIdSync(supportedAssets, this.blockchain, tx.contractAddress);
        const decimals = tx.tokenDecimal ? parseInt(tx.tokenDecimal) : asset?.decimals;

        entries.push({
          senderAddresses: tx.from,
          receiverAddress: depositAddress,
          txId: tx.hash,
          txType: this.getTxType(depositAddress.address),
          txSequence: i,
          blockHeight: parseInt(tx.blockNumber),
          amount: Util.floorByPrecision(EvmUtil.fromWeiAmount(tx.value, decimals), 15),
          asset,
        });
      }
    }

    return entries;
  }

  private getTxType(depositAddress: string): PayInType {
    return Util.equalsIgnoreCase(this.paymentDepositAddress, depositAddress) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
