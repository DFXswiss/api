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

  constructor(
    private readonly payInCardanoService: PayInCardanoService,
    private readonly transactionRequestService: TransactionRequestService,
  ) {
    super();
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

    for (const activeDepositAddress of activeDepositAddresses) {
      await this.pollAddress(BlockchainAddress.create(activeDepositAddress, this.blockchain));
    }
  }

  async pollAddress(depositAddress: BlockchainAddress): Promise<void> {
    if (depositAddress.blockchain !== this.blockchain)
      throw new Error(`Invalid blockchain: ${depositAddress.blockchain}`);

    return this.processNewPayInEntries(depositAddress);
  }

  private async processNewPayInEntries(depositAddress: BlockchainAddress): Promise<void> {
    const log = this.createNewLogObject();

    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    const newEntries = await this.getNewEntries(depositAddress, lastCheckedBlockHeight);

    if (newEntries?.length) {
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getLastCheckedBlockHeight(): Promise<number> {
    return this.payInRepository
      .findOne({
        select: ['id', 'blockHeight'],
        where: { address: { blockchain: this.blockchain } },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  private async getNewEntries(
    depositAddress: BlockchainAddress,
    lastCheckedBlockHeight: number,
  ): Promise<PayInEntry[]> {
    const transactions = await this.payInCardanoService.getHistoryForAddress(depositAddress.address, 50);
    const relevantTransactions = transactions.filter((t) => t.blockNumber > lastCheckedBlockHeight);

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    return this.mapToPayInEntries(depositAddress, relevantTransactions, supportedAssets);
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

  private getTxType(depositAddress: string): PayInType {
    const paymentAddress = CardanoUtil.createWallet({ seed: Config.payment.cardanoSeed, index: 0 }).address;
    return Util.equalsIgnoreCase(paymentAddress, depositAddress) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
