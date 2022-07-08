import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RouteType } from 'src/payment/models/route/deposit-route.entity';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { CryptoInput, CryptoInputType } from './crypto-input.entity';
import { CryptoInputRepository } from './crypto-input.repository';
import { Lock } from 'src/shared/lock';
import { Not } from 'typeorm';
import { Staking } from '../staking/staking.entity';
import { CryptoStakingService } from '../crypto-staking/crypto-staking.service';
import { UpdateCryptoInputDto } from './dto/update-crypto-input.dto';
import { KycStatus } from 'src/user/models/user-data/user-data.entity';

import { NodeNotAccessibleError } from 'src/payment/exceptions/node-not-accessible.exception';
import { AmlCheck } from '../crypto-buy/enums/aml-check.enum';
import { CryptoRoute } from '../crypto-route/crypto-route.entity';
import { CryptoRouteService } from '../crypto-route/crypto-route.service';
import { Blockchain } from '../deposit/deposit.entity';

@Injectable()
export class BitcoinInputService {
  private readonly lock = new Lock(7200);

  private client: NodeClient;
  private defichainClient: NodeClient;

  constructor(
    nodeService: NodeService,
    private readonly cryptoInputRepo: CryptoInputRepository,
    private readonly assetService: AssetService,
    private readonly cryptoRouteService: CryptoRouteService,
    private readonly stakingService: StakingService,
    private readonly cryptoStakingService: CryptoStakingService,
  ) {
    nodeService.getConnectedNode(NodeType.BTC_INPUT).subscribe((client) => (this.client = client));
    nodeService
      .getConnectedNode(NodeType.INPUT)
      .subscribe((defichainClient) => (this.defichainClient = defichainClient));
  }

  async update(bitcoinInputId: number, dto: UpdateCryptoInputDto): Promise<CryptoInput> {
    const cryptoInput = await this.cryptoInputRepo.findOne(bitcoinInputId);
    if (!cryptoInput) throw new NotFoundException('CryptoInput not found');

    return await this.cryptoInputRepo.save({ ...cryptoInput, ...dto });
  }

  // --- INPUT HANDLING --- //
  @Interval(300000)
  async checkInputs(): Promise<void> {
    if (!this.lock.acquire()) return;

    try {
      await this.saveInputs();
      await this.forwardInputs();
    } catch (e) {
      console.error('Exception during crypto input checks:', e);
    } finally {
      this.lock.release();
    }
  }

  private async saveInputs(): Promise<void> {
    const utxos = await this.client.getUtxo();

    const newInputs = await this.getAddressesWithFunds(utxos)
      // map to entities
      .then(() => this.createEntities(utxos))
      .then((i) => i.filter((h) => h != null));

    newInputs.length > 0 && console.log(`New crypto inputs (${newInputs.length}):`, newInputs);

    // side effect, assuming that cryptoStakingRepo and stakingRepo are faultless on save
    for (const input of newInputs) {
      await this.cryptoInputRepo.save(input);
      if (input?.route.type === RouteType.STAKING && input.amlCheck === AmlCheck.PASS) {
        await this.cryptoStakingService.create(input);
      }
    }
  }

  private async createEntities(utxos: UTXO[]): Promise<CryptoInput[]> {
    const inputs = [];

    for (const utxo of utxos) {
      try {
        inputs.push(await this.createEntity(utxo));
      } catch (e) {
        console.error(`Failed to create crypto input ${utxo.txid}:`, e);

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
      console.error(`Failed to process bitcoin input.`);
      return null;
    }

    const usdtAmount = await this.getReferenceAmounts(utxo.amount.toNumber());

    // min. deposit
    if (utxo.amount.toNumber() < Config.node.minBtcDeposit) {
      console.log(`Ignoring too small crypto input (${utxo.amount.toNumber()} 'BTC'`);
      return null;
    }

    // get deposit route
    const route = await this.getDepositRoute(utxo.address);
    if (!route) {
      console.error(`Failed to process crypto input. No matching route for ${utxo.address} found.`);
      return null;
    }

    return this.cryptoInputRepo.create({
      inTxId: utxo.txid,
      outTxId: '', // will be set after crypto forward
      amount: utxo.amount.toNumber(),
      asset: assetEntity,
      route: route,
      btcAmount: utxo.amount.toNumber(),
      usdtAmount: usdtAmount,
      isConfirmed: false,
      amlCheck: route.user.userData.kycStatus === KycStatus.REJECTED ? AmlCheck.FAIL : AmlCheck.PASS,
      type: CryptoInputType.BUY_CRYPTO,
    });
  }

  private async getReferenceAmounts(amount: number, allowRetry = true): Promise<number> {
    try {
      const usdtAmount = await this.defichainClient.testCompositeSwap('BTC', 'USDT', amount);

      return usdtAmount;
    } catch (e) {
      try {
        // poll the node
        await this.client.getInfo();
      } catch (nodeError) {
        throw new NodeNotAccessibleError(NodeType.INPUT, nodeError);
      }

      if (allowRetry) {
        // try once again
        console.log('Retrying testCompositeSwaps after node poll success');
        return await this.getReferenceAmounts(amount, false);
      }

      // re-throw error, likely input related
      throw e;
    }
  }

  private async forwardInputs(): Promise<void> {
    const inputs = await this.cryptoInputRepo.find({
      where: {
        outTxId: '',
        amlCheck: AmlCheck.PASS,
        route: { deposit: { blockchain: Blockchain.BITCOIN } },
      },
      relations: ['route'],
    });

    const utxos = await this.client.getUtxo();

    inputs.length > 0 && console.log(`Forwarding inputs (${inputs.length})`);

    for (const input of inputs) {
      try {
        const utxo = utxos.filter(
          (i) =>
            i.address == input.route.deposit.address && i.txid == input.inTxId && i.amount.toNumber() == input.amount,
        );
        await this.forwardUtxo(input, Config.node.bitcoinWalletAddress, utxo[0].vout);
      } catch (e) {
        console.error(`Failed to forward crypto input ${input.id}:`, e);
      }
    }
  }

  private async forwardUtxo(input: CryptoInput, address: string, vout: number): Promise<void> {
    const outTxId = await this.client.send(address, input.inTxId, input.amount, vout);
    await this.cryptoInputRepo.update({ id: input.id }, { outTxId });
  }

  // --- CONFIRMATION HANDLING --- //
  @Interval(300000)
  async checkConfirmations(): Promise<void> {
    try {
      await this.checkNodeInSync();

      const unconfirmedInputs = await this.cryptoInputRepo.find({
        select: ['id', 'outTxId', 'isConfirmed'],
        where: { isConfirmed: false, outTxId: Not('') },
      });

      for (const input of unconfirmedInputs) {
        try {
          const { confirmations } = await this.client.waitForTx(input.outTxId);
          if (confirmations > 60) {
            await this.cryptoInputRepo.update(input.id, { isConfirmed: true });
          }
        } catch (e) {
          console.error(`Failed to check confirmations of crypto input ${input.id}:`, e);
        }
      }
    } catch (e) {
      console.error('Exception during crypto confirmations checks:', e);
    }
  }

  // --- HELPER METHODS --- //
  private async checkNodeInSync(): Promise<{ headers: number; blocks: number }> {
    const { blocks, headers } = await this.client.getInfo();
    if (blocks < headers - 1) throw new Error(`Node not in sync by ${headers - blocks} block(s)`);

    return { headers, blocks };
  }

  async getAddressesWithFunds(utxo: UTXO[]): Promise<string[]> {
    const utxoAddresses = utxo.filter((u) => u.amount.toNumber() >= Config.node.minBtcDeposit).map((u) => u.address);

    return utxoAddresses;
  }

  private async getDepositRoute(address: string): Promise<CryptoRoute | Staking> {
    return (
      (await this.cryptoRouteService.getCryptoByAddress(address)) ??
      (await this.stakingService.getStakingByAddress(address))
    );
  }
}
