import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto, ZanoTransferReceiveDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoHelper } from 'src/integration/blockchain/zano/zano-helper';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInZanoService } from '../../../services/payin-zano.service';
import { PollingStrategy } from './base/polling.strategy';

@Injectable()
export class ZanoStrategy extends PollingStrategy {
  protected logger: DfxLogger = new DfxLogger(ZanoStrategy);

  constructor(private readonly payInZanoService: PayInZanoService) {
    super();
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  //*** JOBS ***//
  @DfxCron(CronExpression.EVERY_SECOND, { process: Process.PAY_IN, timeout: 7200 })
  async checkPayInEntries(): Promise<void> {
    return super.checkPayInEntries();
  }

  //*** HELPER METHODS ***//
  protected async getBlockHeight(): Promise<number> {
    return this.payInZanoService.getBlockHeight();
  }

  protected async processNewPayInEntries(): Promise<void> {
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
        select: { id: true, blockHeight: true },
        where: { address: { blockchain: this.blockchain } },
        order: { blockHeight: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.blockHeight ?? 0);
  }

  async getNewEntries(lastCheckedBlockHeight: number): Promise<PayInEntry[]> {
    await this.payInZanoService.checkHealthOrThrow();

    const transferInResults = await this.payInZanoService.getTransactionHistory(lastCheckedBlockHeight);
    const relevantTransferInResults = this.filterByRelevantPayments(transferInResults);

    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    return this.mapToPayInEntries(relevantTransferInResults, supportedAssets);
  }

  private filterByRelevantPayments(transferResults: ZanoTransferDto[]): ZanoTransferDto[] {
    return transferResults.filter((t) => t.receive && ZanoHelper.mapPaymentIdHexToIndex(t.paymentId) !== undefined);
  }

  private async mapToPayInEntries(transferResults: ZanoTransferDto[], supportedAssets: Asset[]): Promise<PayInEntry[]> {
    const payInEntries: PayInEntry[] = [];

    for (const transferResult of transferResults) {
      const depositAddress = await this.getDepositAddress(transferResult.paymentId);

      if (depositAddress) {
        payInEntries.push(...this.doMapToPayInEntries(depositAddress, transferResult, supportedAssets));
      }
    }

    return payInEntries;
  }

  private doMapToPayInEntries(
    depositAddress: BlockchainAddress,
    transferResult: ZanoTransferDto,
    supportedAssets: Asset[],
  ): PayInEntry[] {
    const payInEntries: PayInEntry[] = [];

    const transferReceived = Util.groupBy<ZanoTransferReceiveDto, string>(transferResult.receive, 'assetId');

    for (const [assetId, transferReceivedByAssetId] of transferReceived) {
      payInEntries.push({
        senderAddresses: null,
        receiverAddress: depositAddress,
        txId: transferResult.txId,
        txType: this.getTxType(depositAddress.address),
        blockHeight: transferResult.block,
        amount: Util.sum(transferReceivedByAssetId.map((r) => r.amount)),
        asset: supportedAssets.find((a) => Util.equalsIgnoreCase(a.chainId, assetId)),
      });
    }

    return payInEntries;
  }

  private async getDepositAddress(paymentIdHex: string): Promise<BlockchainAddress | undefined> {
    const index = ZanoHelper.mapPaymentIdHexToIndex(paymentIdHex);
    if (index === undefined) return;

    if (0 === index) return BlockchainAddress.create(ZanoHelper.createDepositAddress(index), this.blockchain);

    const deposit = await this.payInZanoService.getDeposit(index);
    if (deposit) return BlockchainAddress.create(deposit.address, this.blockchain);
  }

  private getTxType(depositAddress: string): PayInType {
    return Util.equalsIgnoreCase(Config.payment.zanoAddress, depositAddress) ? PayInType.PAYMENT : PayInType.DEPOSIT;
  }
}
