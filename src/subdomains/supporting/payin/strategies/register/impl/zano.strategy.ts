import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoHelper } from 'src/integration/blockchain/zano/zano-helper';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInZanoService } from '../../../services/payin-zano.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class ZanoStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(ZanoStrategy);

  constructor(private readonly payInZanoService: PayInZanoService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  //*** JOBS ***//

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();

    const lastCheckedBlockHeight = await this.getLastCheckedBlockHeight();

    const newEntries = await this.getNewEntries(lastCheckedBlockHeight);

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

  private async getNewEntries(lastCheckedBlockHeight: number): Promise<PayInEntry[]> {
    await this.payInZanoService.checkHealthOrThrow();

    const transferInResults = await this.payInZanoService.getTransactionHistory(lastCheckedBlockHeight);
    const relevantTransferInResults = this.filterByRelevantPayments(transferInResults);

    return this.mapToPayInEntries(relevantTransferInResults);
  }

  private filterByRelevantPayments(transferResults: ZanoTransferDto[]): ZanoTransferDto[] {
    return transferResults.filter((t) => t.receive && ZanoHelper.mapPaymentIdHexToIndex(t.paymentId) !== undefined);
  }

  private async mapToPayInEntries(transferResults: ZanoTransferDto[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getZanoCoin();

    const payInEntries: PayInEntry[] = [];

    for (const transferResult of transferResults) {
      const depositAddress = await this.getDepositAddress(this.blockchain, transferResult.paymentId);

      if (depositAddress) {
        payInEntries.push({
          senderAddresses: null,
          receiverAddress: depositAddress,
          txId: transferResult.txId,
          txType: this.getTxType(depositAddress.address),
          blockHeight: transferResult.block,
          amount: Util.sum(transferResult.receive.map((r) => r.amount)),
          asset,
        });
      }
    }

    return payInEntries;
  }

  private async getDepositAddress(
    blockchain: Blockchain,
    paymentIdHex: string,
  ): Promise<BlockchainAddress | undefined> {
    const index = ZanoHelper.mapPaymentIdHexToIndex(paymentIdHex);
    if (index === undefined) return;

    const deposit = await this.payInZanoService.getDepositByBlockchainAndIndex(blockchain, index);
    if (deposit) return BlockchainAddress.create(deposit.address, this.blockchain);
  }

  private getTxType(depositAddress: string): PayInType | undefined {
    const zanoAddress = ZanoHelper.splitIntegratedAddress(depositAddress);

    if (!zanoAddress) {
      this.logger.error(`Invalid deposit address ${depositAddress}`);
      return;
    }

    return Util.equalsIgnoreCase(Config.payment.zanoAddress, zanoAddress.address)
      ? PayInType.PAYMENT
      : PayInType.DEPOSIT;
  }
}
