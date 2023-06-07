import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmCoinStrategy {
  blockchain = Blockchain.ARBITRUM;
  assetType = AssetType.COIN;

  constructor(arbitrumService: PayInArbitrumService, payInRepo: PayInRepository) {
    super(arbitrumService, payInRepo);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.arbitrum.arbitrumWalletAddress, Blockchain.ARBITRUM);
  }
}
