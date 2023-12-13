import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  protected readonly logger = new DfxLogger(EthereumStrategy);

  constructor(
    ethereumService: PayInEthereumService,
    payInRepository: PayInRepository,
    assetService: AssetService,
    repos: RepositoryFactory,
  ) {
    super('ETH', ethereumService, payInRepository, assetService, repos);
  }

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  //*** PUBLIC API ***//

  async getReferenceAssets(): Promise<{ btc: Asset; usdt: Asset }> {
    return Promise.all([
      this.assetService.getAssetByQuery({
        dexName: 'WBTC',
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
      }),
      this.assetService.getAssetByQuery({
        dexName: 'USDT',
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
      }),
    ]).then(([btc, usdt]) => ({ btc, usdt }));
  }

  async getSourceAssetRepresentation(asset: Asset): Promise<Asset> {
    return asset;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    return [Config.blockchain.ethereum.ethWalletAddress];
  }

  //*** JOBS ***//

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(7200)
  async checkPayInEntries(): Promise<void> {
    if (DisabledProcess(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }
}
