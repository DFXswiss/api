import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CryptoInput, CryptoInputType } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { Lock } from 'src/shared/lock';
import { IsNull, Not } from 'typeorm';
import { KycStatus } from 'src/user/models/user-data/user-data.entity';
import { NodeNotAccessibleError } from 'src/payment/exceptions/node-not-accessible.exception';
import { AmlCheck } from '../crypto-buy/enums/aml-check.enum';
import { Blockchain } from '../deposit/deposit.entity';
import { CryptoInputService } from './crypto-input.service';
import { BtcClient } from 'src/ain/node/btc-client';
import { CryptoRouteService } from '../crypto-route/crypto-route.service';
import { HttpService } from 'src/shared/services/http.service';
import { BuyCryptoService } from '../buy-crypto/services/buy-crypto.service';

@Injectable()
export class BtcInputService extends CryptoInputService {
  private readonly lock = new Lock(7200);
  private readonly btcFeeUrl = 'https://bitcoinfees.earn.com/api/v1/fees/recommended';

  private btcClient: BtcClient;

  constructor(
    nodeService: NodeService,
    cryptoInputRepo: CryptoInputRepository,
    private readonly http: HttpService,
    private readonly assetService: AssetService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly buyCryptoService: BuyCryptoService,
  ) {
    super(cryptoInputRepo);
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((bitcoinClient) => (this.btcClient = bitcoinClient));
  }

  // --- INPUT HANDLING --- //
  @Interval(300000)
  async checkInputs(): Promise<void> {
    if (!this.lock.acquire()) return;

    try {
      await this.saveInputs();
      await this.forwardInputs();
    } catch (e) {
      console.error('Exception during Bitcoin input checks:', e);
    } finally {
      this.lock.release();
    }
  }

  private async saveInputs(): Promise<void> {
    await this.checkNodeInSync(this.btcClient);

    const utxos = await this.btcClient.getUtxo();

    const newInputs = await this.createEntities(utxos).then((i) => i.filter((h) => h != null));

    newInputs.length > 0 && console.log(`New Bitcoin inputs (${newInputs.length}):`, newInputs);

    for (const input of newInputs) {
      await this.cryptoInputRepo.save(input);
      await this.buyCryptoService.createFromCrypto(input);
    }
  }

  private async createEntities(utxos: UTXO[]): Promise<CryptoInput[]> {
    const inputs = [];

    for (const utxo of utxos) {
      try {
        inputs.push(await this.createEntity(utxo));
      } catch (e) {
        console.error(`Failed to create Bitcoin input ${utxo.txid}:`, e);

        if (e instanceof NodeNotAccessibleError) {
          // abort the process until next interval cycle
          throw e;
        }
      }
    }

    return inputs;
  }

  private async createEntity(utxo: UTXO): Promise<CryptoInput> {
    // get asset
    const assetEntity = await this.assetService.getAssetByDexName('BTC');
    if (!assetEntity) {
      console.error(`Failed to process Bitcoin input. No asset BTC found. UTXO:`, utxo);
      return null;
    }

    // min. deposit
    if (utxo.amount.toNumber() < Config.node.minBtcDeposit) {
      console.log(`Ignoring too small Bitcoin input (${utxo.amount.toNumber()} 'BTC'. UTXO:`, utxo);
      return null;
    }

    // get crypto route
    const route = await this.cryptoRouteService.getCryptoRouteByAddress(utxo.address);
    if (!route) {
      console.error(`Failed to process Bitcoin input. No matching route for ${utxo.address} found.. UTXO:`, utxo);
      return null;
    }

    // check if already registered
    const existingInput = await this.cryptoInputRepo.findOne({
      where: { inTxId: utxo.txid, vout: utxo.vout, asset: assetEntity, route: route },
      relations: ['asset', 'route'],
    });
    if (existingInput) return null;

    return this.cryptoInputRepo.create({
      inTxId: utxo.txid,
      amount: utxo.amount.toNumber(),
      asset: assetEntity,
      route: route,
      btcAmount: utxo.amount.toNumber(),
      isConfirmed: false,
      amlCheck: route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS,
      type: CryptoInputType.BUY_CRYPTO,
      vout: utxo.vout,
    });
  }

  private async forwardInputs(): Promise<void> {
    const inputs = await this.cryptoInputRepo.find({
      where: {
        outTxId: IsNull(),
        amlCheck: AmlCheck.PASS,
        route: { deposit: { blockchain: Blockchain.BITCOIN } },
      },
      relations: ['route'],
    });

    for (const input of inputs) {
      try {
        await this.forwardUtxo(input, Config.node.btcCollectorAddress);
      } catch (e) {
        console.error(`Failed to forward Bitcoin input ${input.id}:`, e);
      }
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string): Promise<void> {
    const outTxId = await this.btcClient.send(
      address,
      input.inTxId,
      input.amount,
      input.vout,
      await this.getFeeRate(input.amount),
    );
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
  }

  private async getFeeRate(amount: number): Promise<number> {
    const { fastestFee } = await this.http.get<{ fastestFee: number; halfHourFee: number; hourFee: number }>(
      this.btcFeeUrl,
      {
        tryCount: 3,
      },
    );
    return Math.max(Math.min(fastestFee, 500 * amount), 1);
  }

  // --- CONFIRMATION HANDLING --- //
  @Interval(300000)
  async checkConfirmations(): Promise<void> {
    try {
      await this.checkNodeInSync(this.btcClient);

      const unconfirmedInputs = await this.cryptoInputRepo.find({
        select: ['id', 'outTxId', 'isConfirmed'],
        where: {
          isConfirmed: false,
          outTxId: Not(IsNull()),
          route: { deposit: { blockchain: Blockchain.BITCOIN } },
        },
        relations: ['route'],
      });

      for (const input of unconfirmedInputs) {
        try {
          const { confirmations } = await this.btcClient.waitForTx(input.outTxId);
          if (confirmations > 1) {
            await this.cryptoInputRepo.update(input.id, { isConfirmed: true });
          }
        } catch (e) {
          console.error(`Failed to check confirmations of Bitcoin input ${input.id}:`, e);
        }
      }
    } catch (e) {
      console.error('Exception during Bitcoin confirmations checks:', e);
    }
  }
}
