import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { CardanoUtil } from 'src/integration/blockchain/cardano/cardano.util';
import { CardanoTransactionDto } from 'src/integration/blockchain/cardano/dto/cardano.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInCardanoService } from '../../../services/payin-cardano.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class CardanoStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(CardanoStrategy);

  private readonly cardanoPaymentDepositAddress: string;

  constructor(
    private readonly payInCardanoService: PayInCardanoService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {
    super();

    this.cardanoPaymentDepositAddress = CardanoUtil.createWallet({
      seed: Config.payment.cardanoSeed,
      index: 0,
    }).address;
  }

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    const activeDepositAddresses = await this.transactionRequestService.getActiveDepositAddresses(
      Util.hoursBefore(1),
      this.blockchain,
    );

    if (this.cardanoPaymentDepositAddress) activeDepositAddresses.push(this.cardanoPaymentDepositAddress);

    await this.processNewPayInEntries(activeDepositAddresses.map((a) => BlockchainAddress.create(a, this.blockchain)));
  }

  async pollAddress(depositAddress: BlockchainAddress, fromBlock?: number, toBlock?: number): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries([depositAddress], fromBlock, toBlock);
  }

  private async processNewPayInEntries(
    depositAddresses: BlockchainAddress[],
    fromBlock?: number,
    toBlock?: number,
  ): Promise<void> {
    const log = this.createNewLogObject();

    const newEntries: PayInEntry[] = [];

    for (const depositAddress of depositAddresses) {
      const from = fromBlock ?? (await this.getLastCheckedBlockHeight(depositAddress)) + 1;

      newEntries.push(...(await this.getNewEntries(depositAddress, from, toBlock)));
    }

    if (newEntries?.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getLastCheckedBlockHeight(depositAddress: BlockchainAddress): Promise<number> {
    return this.payInRepository
      .findOne({
        select: { id: true, blockHeight: true },
        where: { address: depositAddress },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getNewEntries(
    depositAddress: BlockchainAddress,
    fromBlock: number,
    toBlock?: number,
  ): Promise<PayInEntry[]> {
    const transactions = await this.payInCardanoService.getHistoryForAddress(depositAddress.address, 50);
    const relevantTransactions = this.filterByRelevantTransactions(transactions, depositAddress, fromBlock, toBlock);

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    return this.mapToPayInEntries(depositAddress, relevantTransactions, supportedAssets);
  }

  private filterByRelevantTransactions(
    transactions: CardanoTransactionDto[],
    depositAddress: BlockchainAddress,
    fromBlock: number,
    toBlock?: number,
  ): CardanoTransactionDto[] {
    return transactions
      .filter((t) => t.to.toLowerCase().includes(depositAddress.address.toLowerCase()))
      .filter((t) => t.blockNumber >= fromBlock)
      .filter((t) => !toBlock || t.blockNumber <= toBlock);
  }

  private async mapToPayInEntries(
    depositAddress: BlockchainAddress,
    transactions: CardanoTransactionDto[],
    supportedAssets: Asset[],
  ): Promise<PayInEntry[]> {
    const payInEntries: PayInEntry[] = [];

    for (const transaction of transactions) {
      payInEntries.push({
        senderAddresses: transaction.from,
        receiverAddress: depositAddress,
        txId: transaction.txId,
        txType: this.getTxType(depositAddress.address),
        blockHeight: transaction.blockNumber,
        amount: transaction.amount,
        asset: supportedAssets.find((a) => a.type === AssetType.COIN),
      });
    }

    return payInEntries;
  }

  private getTxType(address: string): PayInType {
    return Util.equalsIgnoreCase(this.cardanoPaymentDepositAddress, address) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
