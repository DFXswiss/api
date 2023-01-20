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

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  private readonly lock = new Lock(7200);

  constructor(
    private readonly assetService: AssetService,
    private readonly bitcoinService: PayInBitcoinService,
    protected readonly payInService: PayInService,
    protected readonly payInFactory: PayInFactory,
    protected readonly payInRepository: PayInRepository,
  ) {
    super(payInFactory, payInRepository);
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
    const referencePrices = await this.payInService.getReferencePrices(newEntries);

    for (const tx of newEntries) {
      try {
        await this.createPayInAndSave(tx, referencePrices);
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
