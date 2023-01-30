import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payoutService: PayoutService,
    protected readonly ethereumService: PayInEthereumService,
    payInRepo: PayInRepository,
  ) {
    super(dexService, payoutService, ethereumService, payInRepo, Blockchain.ETHEREUM);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.ethereum.ethWalletAddress, Blockchain.ETHEREUM);
  }

  protected async getAssetRepresentationForFee(asset: Asset): Promise<Asset> {
    /**
     * no asset replacement needed to calculate targetAsset fee amount
     */
    return asset;
  }
}
