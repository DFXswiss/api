import { Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { Config, Process } from 'src/config/config';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PayInEntry } from '../../../interfaces';
import { PayInRepository } from '../../../repositories/payin.repository';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { PayInFactory } from '../../../factories/payin.factory';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInService } from '../../../services/payin.service';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CryptoRoute } from 'src/mix/models/crypto-route/crypto-route.entity';
import { Staking } from 'src/mix/models/staking/staking.entity';
import { AmlCheck } from 'src/subdomains/core/buy-crypto/process/enums/aml-check.enum';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { ChainalysisService } from 'src/integration/chainalysis/services/chainalysis.service';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  private readonly lock = new Lock(7200);

  constructor(
    private readonly assetService: AssetService,
    private readonly bitcoinService: PayInBitcoinService,
    private readonly chainalysisService: ChainalysisService,
    protected readonly dexService: DexService,
    protected readonly payInService: PayInService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(dexService, payInFactory, payInRepository);
  }

  //*** PUBLIC API ***//

  async doAmlCheck(payIn: CryptoInput, route: Staking | Sell | CryptoRoute): Promise<AmlCheck> {
    if (route.user.userData.kycStatus === KycStatus.REJECTED) return AmlCheck.FAIL;

    // TODO just check chainalysis if amount in EUR > 10k or userData.highRisk
    const highRisk = await this.chainalysisService.isHighRiskTx(
      route.user.userData.id,
      payIn.inTxId,
      payIn.txSequence,
      'BTC',
      Blockchain.BITCOIN,
    );
    return highRisk ? AmlCheck.FAIL : AmlCheck.PASS;
  }

  /**
   * @note
   * accepting CryptoInput (PayIn) entities for retry mechanism (see PayInService -> #retryGettingReferencePrices())
   */
  async addReferenceAmounts(entries: PayInEntry[] | CryptoInput[]): Promise<void> {
    const btc = await this.assetService.getAssetByQuery({
      dexName: 'BTC',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    const usdt = await this.assetService.getAssetByQuery({
      dexName: 'USDT',
      blockchain: Blockchain.DEFICHAIN,
      type: AssetType.TOKEN,
    });

    for (const entry of entries) {
      try {
        const btcAmount = entry.amount;

        // TODO -> not sure if we should restrict this for Bitcoin (what if defichain node is OFF)
        const usdtAmount = await this.getReferenceAmount(btc, entry.amount, usdt);

        await this.addReferenceAmountsToEntry(entry, btcAmount, usdtAmount);
      } catch (e) {
        console.error('Could not set reference amounts for Bitcoin pay-in', e);
        continue;
      }
    }
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPayInEntries(): Promise<void> {
    if (Config.processDisabled(Process.PAY_IN)) return;
    if (!this.lock.acquire()) return;

    try {
      await this.processNewPayInEntries();
    } catch (e) {
      console.error('Exception during DeFiChain pay in checks:', e);
    } finally {
      this.lock.release();
    }
  }

  //*** HELPER METHODS ***//

  private async processNewPayInEntries(): Promise<void> {
    const log = this.createNewLogObject();
    const newEntries = await this.getNewEntries();

    await this.addReferenceAmounts(newEntries);

    for (const tx of newEntries) {
      try {
        await this.createPayInAndSave(tx);
        log.newRecords.push({ address: tx.address.address, txId: tx.txId });
      } catch (e) {
        console.error('Did not register pay-in: ', e);
        continue;
      }
    }

    this.printInputLog(log, 'omitted', Blockchain.BITCOIN);
  }

  private async getNewEntries(): Promise<PayInEntry[]> {
    const allUtxos = await this.bitcoinService.getUTXO();
    const newUtxos = await this.filterOutExistingUtxos(allUtxos);

    return this.mapUtxosToEntries(newUtxos);
  }

  private async filterOutExistingUtxos(allUtxos: UTXO[]): Promise<UTXO[]> {
    const inputs = [];

    for (const utxo of allUtxos) {
      const assetEntity = await this.assetService.getBtcCoin();

      if (!assetEntity) {
        console.error(`Failed to process Bitcoin input. No asset BTC found. UTXO:`, utxo);
        continue;
      }

      const existingInput = await this.payInRepository.findOne({
        inTxId: utxo.txid,
        txSequence: utxo.vout,
        asset: assetEntity,
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
      blockHeight: null,
      amount: u.amount.toNumber(),
      asset,
    }));
  }
}
