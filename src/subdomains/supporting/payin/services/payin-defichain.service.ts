import { AccountHistory as JellyAccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInRepository } from '../repositories/payin.repository';
import { PayInJellyfishService } from './base/payin-jellyfish.service';

interface HistoryAmount {
  amount: number;
  asset: string;
}

export type AccountHistory = Omit<JellyAccountHistory & HistoryAmount & { assetType: AssetType }, 'amounts'>;

@Injectable()
export class PayInDeFiChainService extends PayInJellyfishService {
  private client: DeFiClient;

  private readonly utxoTxTypes = ['receive', 'AccountToUtxos'];
  private readonly tokenTxTypes = [
    'AccountToAccount',
    'AnyAccountsToAccounts',
    'WithdrawFromVault',
    'PoolSwap',
    'RemovePoolLiquidity',
  ];

  constructor(protected readonly payInRepo: PayInRepository, nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.INPUT).subscribe((client) => (this.client = client));
    super();
  }

  async checkHealthOrThrow(): Promise<void> {
    await this.checkNodeInSync(this.client);
  }

  async getNewTransactionsHistorySince(lastHeight: number): Promise<AccountHistory[]> {
    const { blocks: currentHeight } = await this.client.checkSync();

    return this.client
      .getHistory(lastHeight + 1, currentHeight)
      .then((i) => i.filter((h) => h.blockHeight > lastHeight))
      .then((i) => this.splitHistories(i))
      .then((i) => i.filter((a) => this.isDFI(a) || this.isDUSD(a)))
      .then((i) => i.map((a) => ({ ...a, amount: Math.abs(a.amount) })));
  }

  async sendUtxo(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.client.sendCompleteUtxo(input.address.address, input.destinationAddress.address, input.amount);
  }

  async sendToken(input: CryptoInput, action: (outTxId: string) => CryptoInput): Promise<void> {
    await this.doTokenTx(input.address.address, async (utxo) => {
      const outTxId = await this.client.sendToken(
        input.address.address,
        input.destinationAddress.address,
        input.asset.dexName,
        input.amount,
        [utxo],
      );

      const updatedInput = action(outTxId);
      await this.payInRepo.save(updatedInput);

      return outTxId;
    });
  }

  //*** HELPER METHODS ***//

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

  private async doTokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>): Promise<void> {
    const feeUtxo = await this.getFeeUtxo(addressFrom);
    feeUtxo ? await this.tokenTx(addressFrom, tx, feeUtxo) : void this.tokenTx(addressFrom, tx); // no waiting;
  }

  private async tokenTx(addressFrom: string, tx: (utxo: UTXO) => Promise<string>, feeUtxo?: UTXO): Promise<void> {
    try {
      // get UTXO
      if (!feeUtxo) {
        const utxoTx = await this.sendFeeUtxo(addressFrom);
        await this.client.waitForTx(utxoTx);
        feeUtxo = await this.client
          .getUtxo()
          .then((utxos) => utxos.find((u) => u.txid === utxoTx && u.address === addressFrom));
      }

      // do TX
      await tx(feeUtxo);
    } catch (e) {
      console.error('Failed to do token TX:', e);
    }
  }

  private async getFeeUtxo(address: string): Promise<UTXO | undefined> {
    return await this.client
      .getUtxo()
      .then((utxos) =>
        utxos.find(
          (u) =>
            u.address === address &&
            u.amount.toNumber() < Config.blockchain.default.minDeposit.DeFiChain.DFI &&
            u.amount.toNumber() > Config.blockchain.default.minDeposit.DeFiChain.DFI / 4,
        ),
      );
  }

  private async sendFeeUtxo(address: string): Promise<string> {
    return await this.client.sendUtxo(
      Config.blockchain.default.utxoSpenderAddress,
      address,
      Config.blockchain.default.minDeposit.DeFiChain.DFI / 2,
    );
  }

  private parseAmount(amount: string): HistoryAmount {
    return { ...this.client.parseAmount(amount) };
  }
}
