import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { filter } from 'rxjs';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeMode, NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellService } from 'src/user/models/sell/sell.service';
import { CryptoInput } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';

@Injectable()
export class CryptoInputService {
  private readonly client: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly sellService: SellService,
  ) {
    this.client = nodeService.getClient(NodeType.INPUT, NodeMode.ACTIVE);
    this.checkInputs();
  }

  @Interval(300000)
  async checkInputs(): Promise<void> {
    try {
      // get block heights
      const currentHeight = await this.client.getInfo().then((info) => info.blocks);
      const lastHeight = await this.cryptoInputRepo
        .findOne({ order: { blockHeight: 'DESC' } })
        .then((input) => input?.blockHeight ?? 0);

      // TODO: ignore own wallet address (UTXO holdings)

      await this.client
        // get UTXOs >= 0.1 DFI
        .getAddresses()
        // Filter out unwanted addresses (aka wallet address)
        .then((i) => i.filter((e) => e != 'tWGFApzyspQaMmyhyBfn8igS5EHcbuG23F'))
        // get receive history
        .then((i) => Promise.all(i.map((a) => this.client.getHistory(a, lastHeight + 1, currentHeight))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h.type === 'receive' || h.type === 'AccountToAccount'))
        // map to entities
        .then((i) => Promise.all(i.map((h) => this.createEntities(h))))
        .then((i) => i.reduce((prev, curr) => prev.concat(curr), []))
        .then((i) => i.filter((h) => h != null))
        .then((i) => {
          if (i.length > 0) console.log('New crypto inputs:', i);
          return i;
        })
        // save and forward
        .then((i) => Promise.all(i.map((e) => this.saveAndForward(e))));
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async createEntities(history: AccountHistory): Promise<CryptoInput[]> {
    return Promise.all(
      history.amounts.map(async (a) => {
        const amount = +a.split('@')[0];
        const assetName = a.split('@')[1];

        if (assetName == 'DFI' && amount < 0.1)
          return null;

        // We only know if it was a receive on AnyAccountsToAccounts if the amount is positive
        if (history.type == 'AccountToAccount' && amount < 0)
          return null;

        // get asset
        const asset = await this.assetService.getAssetByDexName(assetName);
        if (!asset) {
          console.error(`Failed to process crypto input. No asset ${assetName} found. History entry:`, history);
          return null;
        }

        // get sell route
        const sell = await this.sellService.getSellForAddress(history.owner);
        if (!sell) {
          console.error(`Failed to process crypto input. No matching sell found. History entry:`, history);
          return null;
        }

        const btcAmount = +(await this.client.testCompositePoolSwap(sell.deposit.address, assetName, 'BTC', amount)).split('@')[0];

        let usdtAmount = 0;
        if (assetName != 'USDT')
          usdtAmount = +(await this.client.testCompositePoolSwap(sell.deposit.address, assetName, 'USDT', amount)).split('@')[0];
        else
          usdtAmount = amount;

        if (usdtAmount < 1)
          return null;

        return this.cryptoInputRepo.create({
          inTxId: history.txid,
          outTxId: '', // will be set after crypto forward
          blockHeight: history.blockHeight,
          amount: amount,
          asset: asset,
          sell: sell,
          btcAmount: btcAmount, 
          usdtAmount: usdtAmount
        });
      }),
    );
  }

  private async saveAndForward(input: CryptoInput): Promise<void> {
    try {
      // save
      await this.cryptoInputRepo.save(input);

      let outTxId = '';
      if (input.asset.dexName == 'DFI') {
         outTxId = await this.client.sendUtxo(
          input.sell.deposit.address,
          Config.node.dexWalletAddress,
          input.amount,
        );
      } else {
        // It is a token
        // 1. Get UTXO
        // 2. Send accountToAccount
        // 3. Get rid of remaining UTXO
        const utxotx = await this.client.sendUtxo(
          'tWGFApzyspQaMmyhyBfn8igS5EHcbuG23F',
          input.sell.deposit.address,
          0.01
        )

        await this.client.waitForTx(utxotx);

        outTxId = await this.client.sendToken(
          input.sell.deposit.address,
          Config.node.dexWalletAddress,
          input.asset.dexName,
          input.amount
        );
      }

      // update out TX ID
      await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
    } catch (e) {
      console.error(`Failed to process crypto input:`, e);
    }
  }
}
