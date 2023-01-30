import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payoutService: PayoutService,
    protected readonly bscService: PayInBscService,
    payInRepo: PayInRepository,
  ) {
    super(dexService, payoutService, bscService, payInRepo, Blockchain.BINANCE_SMART_CHAIN);
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
