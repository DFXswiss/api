import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Lock } from 'src/shared/utils/lock';
import { Config, Process } from 'src/config/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { PayInFactory } from '../../../factories/payin.factory';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';
import { PayInService } from '../../../services/payin.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class EthereumStrategy extends EvmStrategy {
  protected readonly logger = new DfxLogger(EthereumStrategy);

  constructor(
    dexService: DexService,
    @Inject(forwardRef(() => PayInService))
    payInService: PayInService,
    ethereumService: PayInEthereumService,
    payInFactory: PayInFactory,
    payInRepository: PayInRepository,
    assetService: AssetService,
    repos: RepositoryFactory,
  ) {
    super(
      Blockchain.ETHEREUM,
      'ETH',
      dexService,
      payInService,
      ethereumService,
      payInFactory,
      payInRepository,
      assetService,
      repos,
    );
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
    if (Config.processDisabled(Process.PAY_IN)) return;

    await this.processNewPayInEntries();
  }
}
