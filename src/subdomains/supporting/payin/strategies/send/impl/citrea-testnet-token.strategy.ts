import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class CitreaTestnetTokenStrategy extends EvmTokenStrategy {
  constructor(citreaTestnetService: PayInCitreaTestnetService, payInRepo: PayInRepository) {
    super(citreaTestnetService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    const citreaConfig = Config.blockchain.citreaTestnet;
    if (!citreaConfig || !citreaConfig.citreaTestnetWalletAddress) {
      throw new Error('CitreaTestnet configuration is missing or incomplete. CITREA_TESTNET_WALLET_ADDRESS must be configured.');
    }
    return BlockchainAddress.create(citreaConfig.citreaTestnetWalletAddress, Blockchain.CITREA_TESTNET);
  }
}