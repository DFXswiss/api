import { Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { GetTransferInResultDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInMoneroService } from '../../../services/payin-monero.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class MoneroStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(MoneroStrategy);

  constructor(
    private readonly assetService: AssetService,
    private readonly payInMoneroService: PayInMoneroService,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInRepository);
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  //*** PUBLIC API ***//

  async doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<CheckStatus> {
    return route.user.userData.kycStatus === KycStatus.REJECTED ? CheckStatus.FAIL : CheckStatus.PASS;
  }

  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    for (const entry of entries) {
      try {
        const xmrAmount = entry.amount;
        const usdtAmount = null;

        await this.addReferenceAmountsToEntry(entry, xmrAmount, usdtAmount);
      } catch (e) {
        this.logger.error('Could not set reference amounts for Monero pay-in:', e);
        continue;
      }
    }
  }

  //*** JOBS ***//

  //  @Cron(CronExpression.EVERY_MINUTE)
  //   @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();

    const lastCheckedTxId = await this.payInRepository
      .findOne({
        select: ['inTxId'],
        where: { address: { blockchain: this.blockchain } },
        order: { id: 'DESC' },
        loadEagerRelations: false,
      })
      .then((input) => input?.inTxId ?? '');

    const newEntries = await this.getNewEntries(lastCheckedTxId);

    if (newEntries) {
      await this.addReferenceAmounts(newEntries);
      await this.createPayInsAndSave(newEntries, log);
    }

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async getNewEntries(lastCheckedTxId: string): Promise<PayInEntry[]> {
    const isHealthy = await this.payInMoneroService.isHealthy();
    if (!isHealthy) throw new Error('Monero Node not in sync');

    const transferInResults = await this.payInMoneroService.getTransactionHistory(lastCheckedTxId);
    return this.mapToPayInEntries(transferInResults);
  }

  private async mapToPayInEntries(transferInResults: GetTransferInResultDto[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getMoneroCoin();

    return [...transferInResults].reverse().map((p) => ({
      address: BlockchainAddress.create(p.address, this.blockchain),
      txId: p.txid,
      txType: null,
      blockHeight: p.height,
      amount: MoneroHelper.auToXmr(p.amount),
      asset,
    }));
  }
}
