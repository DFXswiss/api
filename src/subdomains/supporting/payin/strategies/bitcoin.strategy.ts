import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { Lock } from 'src/shared/utils/lock';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { Config, Process } from 'src/config/config';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInEntry } from '../interfaces';
import { PayInRepository } from '../repositories/payin.repository';
import { PayInService } from '../services/payin.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  private readonly lock = new Lock(7200);
  private client: BtcClient;

  constructor(
    private readonly assetService: AssetService,
    private readonly payInService: PayInService,
    private readonly payInRepository: PayInRepository,
    nodeService: NodeService,
  ) {
    super();
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.client = client));
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
    const newEntries = await this.getNewEntries();
    const newPayIns = await this.payInService.createNewPayIns(newEntries);

    newPayIns.length > 0 && console.log(`New Bitcoin pay-ins (${newPayIns.length}):`, newPayIns);

    await this.payInService.persistPayIns(newPayIns);
  }

  private async getNewEntries(): Promise<PayInEntry[]> {
    const allUtxos = await this.getUTXO();
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
        txId: utxo.txid,
        vout: utxo.vout,
        asset: assetEntity,
      });

      if (existingInput) continue;

      inputs.push(utxo);
    }

    return inputs;
  }

  private async getUTXO(): Promise<UTXO[]> {
    await this.client.checkSync();

    return this.client.getUtxo();
  }

  private mapUtxosToEntries(utxos: UTXO[]): PayInEntry[] {
    return utxos.map((u) => ({
      address: BlockchainAddress.create(u.owner, Blockchain.BITCOIN),
      type: u.type,
      txId: u.txid,
      blockHeight: u.blockHeight,
      amount: u.amount,
      asset: u.asset,
      assetType: u.assetType,
    }));
  }
}
