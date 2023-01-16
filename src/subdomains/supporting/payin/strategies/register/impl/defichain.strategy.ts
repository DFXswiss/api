import { Injectable } from '@nestjs/common';
import { Config, Process } from 'src/config/config';
import { AccountHistory as JellyAccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { PayInEntry } from '../interfaces';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInStrategy } from './impl/base/payin.strategy';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Lock } from 'src/shared/utils/lock';
import { PayInService } from '../services/payin.service';
import { PayInRepository } from '../repositories/payin.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';

interface HistoryAmount {
  amount: number;
  asset: string;
}

type AccountHistory = Omit<JellyAccountHistory & HistoryAmount & { assetType: AssetType }, 'amounts'>;

@Injectable()
export class DeFiChainStrategy extends PayInStrategy {
  private readonly lock = new Lock(7200);
  private client: DeFiClient;

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos'];
  private readonly tokenTxTypes = [
    'AccountToAccount',
    'AnyAccountsToAccounts',
    'WithdrawFromVault',
    'PoolSwap',
    'RemovePoolLiquidity',
  ];

  constructor(
    private readonly payInService: PayInService,
    private readonly payInRepository: PayInRepository,
    private readonly assetService: AssetService,
    nodeService: NodeService,
  ) {
    super();
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
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
    const lastCheckedBlockHeight = await this.payInRepository
      .findOne({ order: { blockHeight: 'DESC' } })
      .then((input) => input?.blockHeight ?? 0);

    const newEntries = await this.getNewEntriesSince(lastCheckedBlockHeight);
    const newPayIns = await this.payInService.createNewPayIns(newEntries);

    newPayIns.length > 0 && console.log(`New DeFiChain pay ins (${newPayIns.length}):`, newPayIns);

    await this.payInService.persistPayIns(newPayIns);
  }

  private async getNewEntriesSince(lastHeight: number): Promise<PayInEntry[]> {
    const supportedAssets = await this.assetService.getAllAsset([Blockchain.DEFICHAIN]);
    const histories = await this.getNewTransactionsHistorySince(lastHeight);

    return this.mapHistoriesToEntries(histories, supportedAssets);
  }

  private async getNewTransactionsHistorySince(lastHeight: number): Promise<AccountHistory[]> {
    const { blocks: currentHeight } = await this.client.checkSync();

    return this.client
      .getHistory(lastHeight + 1, currentHeight)
      .then((i) => i.filter((h) => h.blockHeight > lastHeight))
      .then((i) => this.splitHistories(i))
      .then((i) => i.filter((a) => this.isDFI(a) || this.isDUSD(a)))
      .then((i) => i.map((a) => ({ ...a, amount: Math.abs(a.amount) })));
  }

  private splitHistories(histories: JellyAccountHistory[]): AccountHistory[] {
    return histories
      .map((h) => h.amounts.map((a) => ({ ...h, ...this.parseAmount(a), assetType: this.getAssetType(h) })))
      .reduce((prev, curr) => prev.concat(curr), []);
  }

  private getAssetType(history: JellyAccountHistory): AssetType | undefined {
    if (this.utxoTxTypes.includes(history.type)) return AssetType.COIN;
    if (this.tokenTxTypes.includes(history.type)) return AssetType.TOKEN;
  }

  private isDFI(history: AccountHistory): boolean {
    return (
      history.assetType === AssetType.COIN &&
      history.asset === 'DFI' &&
      Math.abs(history.amount) >= Config.payIn.min.DeFiChain.DFI
    );
  }

  private isDUSD(history: AccountHistory): boolean {
    return (
      history.assetType === AssetType.TOKEN &&
      history.asset === 'DUSD' &&
      history.amount >= Config.payIn.min.DeFiChain.DUSD
    );
  }

  private mapHistoriesToEntries(histories: AccountHistory[], supportedAssets: Asset[]): PayInEntry[] {
    return histories.map((h) => ({
      address: BlockchainAddress.create(h.owner, Blockchain.DEFICHAIN),
      txId: h.txid,
      blockHeight: h.blockHeight,
      amount: h.amount,
      asset: this.assetService.getByNameSync(supportedAssets, h.asset, Blockchain.DEFICHAIN) ?? null,
    }));
  }

  private parseAmount(amount: string): HistoryAmount {
    return { ...this.client.parseAmount(amount) };
  }
}
