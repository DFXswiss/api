import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class CitreaTestnetCoinStrategy extends EvmCoinStrategy {
  constructor(citreaTestnetService: PayInCitreaTestnetService, payInRepo: PayInRepository) {
    super(citreaTestnetService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(
      Config.blockchain.citreaTestnet.citreaTestnetWalletAddress,
      Blockchain.CITREA_TESTNET,
    );
  }
}
