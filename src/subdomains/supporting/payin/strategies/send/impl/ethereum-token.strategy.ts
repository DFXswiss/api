import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  blockchain = Blockchain.ETHEREUM;
  assetType = AssetType.TOKEN;

  constructor(ethereumService: PayInEthereumService, payInRepo: PayInRepository) {
    super(ethereumService, payInRepo);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.ethereum.ethWalletAddress, Blockchain.ETHEREUM);
  }
}
