import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ChainalysisService } from 'src/integration/chainalysis/services/chainalysis.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { CheckStatus } from 'src/subdomains/core/buy-crypto/process/enums/check-status.enum';
import { CryptoRoute } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.entity';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { Staking } from 'src/subdomains/core/staking/entities/staking.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { JellyfishStrategy } from './base/jellyfish.strategy';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(
    private readonly assetService: AssetService,
    private readonly bitcoinService: PayInBitcoinService,
    private readonly chainalysisService: ChainalysisService,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInRepository);
  }

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  //*** PUBLIC API ***//

  async doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<CheckStatus> {
    if (route.user.userData.kycStatus === KycStatus.REJECTED) return CheckStatus.FAIL;

    // TODO just check chainalysis if amount in EUR > 10k or userData.highRisk
    const highRisk = await this.chainalysisService.isHighRiskTx(
      route.user.userData.id,
      payIn.inTxId,
      payIn.txSequence,
      'BTC',
      Blockchain.BITCOIN,
    );
    return highRisk ? CheckStatus.FAIL : CheckStatus.PASS;
  }

  /**
   * @note
   * accepting CryptoInput (PayIn) entities for retry mechanism (see PayInService -> #retryGettingReferencePrices())
   */
  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    for (const entry of entries) {
      try {
        const btcAmount = entry.amount;
        const usdtAmount = null;

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        this.logger.error('Could not set reference amounts for Bitcoin pay-in:', e);
        continue;
      }
    }
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const newEntries = await this.getNewEntries();

    await this.addReferenceAmounts(newEntries);

    await this.createPayInsAndSave(newEntries, log);

    this.printInputLog(log, 'omitted', Blockchain.BITCOIN);
  }

  private async getNewEntries(): Promise<PayInEntry[]> {
    await this.bitcoinService.checkHealthOrThrow();

    const allUtxos = await this.bitcoinService.getUtxo();
    const newUtxos = await this.filterOutExistingUtxos(allUtxos);

    return this.mapUtxosToEntries(newUtxos);
  }

  private async filterOutExistingUtxos(allUtxos: UTXO[]): Promise<UTXO[]> {
    const inputs = [];

    for (const utxo of allUtxos) {
      const existingInput = await this.payInRepository.findOneBy({
        inTxId: utxo.txid,
        txSequence: utxo.vout,
        address: { address: utxo.address },
      });

      if (existingInput) continue;

      inputs.push(utxo);
    }

    return inputs;
  }

  private async mapUtxosToEntries(utxos: UTXO[]): Promise<PayInEntry[]> {
    const asset = await this.assetService.getBtcCoin();

    return utxos.map((u) => ({
      address: BlockchainAddress.create(u.address, Blockchain.BITCOIN),
      txId: u.txid,
      txType: null,
      txSequence: u.vout,
      blockHeight: null,
      amount: u.amount.toNumber(),
      asset,
    }));
  }
}
