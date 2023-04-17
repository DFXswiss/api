import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

@Injectable()
export class ArbitrumCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly priceProvider: PriceProviderService,
    protected readonly payoutService: PayoutService,
    protected readonly arbitrumService: PayInArbitrumService,
    protected readonly assetService: AssetService,
    payInRepo: PayInRepository,
  ) {
    super(priceProvider, payoutService, arbitrumService, payInRepo, Blockchain.ARBITRUM);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.arbitrum.arbitrumWalletAddress, Blockchain.ARBITRUM);
  }

  protected async getAssetRepresentationForFee(asset: Asset): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      dexName: asset.dexName,
      blockchain: Blockchain.ETHEREUM,
      type: asset.type,
    });
  }
}
