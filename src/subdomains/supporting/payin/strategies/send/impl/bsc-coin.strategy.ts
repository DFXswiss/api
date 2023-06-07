import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  blockchain = Blockchain.BINANCE_SMART_CHAIN;
  assetType = AssetType.COIN;

  constructor(bscService: PayInBscService, payInRepo: PayInRepository) {
    super(bscService, payInRepo);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.bsc.bscWalletAddress, Blockchain.BINANCE_SMART_CHAIN);
  }
}
