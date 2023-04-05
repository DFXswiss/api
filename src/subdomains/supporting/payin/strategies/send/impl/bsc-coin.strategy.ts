import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly priceProvider: PriceProviderService,
    protected readonly payoutService: PayoutService,
    protected readonly bscService: PayInBscService,
    payInRepo: PayInRepository,
  ) {
    super(priceProvider, payoutService, bscService, payInRepo, Blockchain.BINANCE_SMART_CHAIN);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.bsc.bscWalletAddress, Blockchain.BINANCE_SMART_CHAIN);
  }

  protected async getAssetRepresentationForFee(asset: Asset): Promise<Asset> {
    /**
     * no asset replacement needed to calculate targetAsset fee amount
     */
    return asset;
  }
}
