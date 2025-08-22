import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInSepoliaService } from '../../../services/payin-sepolia.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class SepoliaCoinStrategy extends EvmCoinStrategy {
  constructor(sepoliaService: PayInSepoliaService, payInRepo: PayInRepository) {
    super(sepoliaService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.SEPOLIA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.sepolia.sepoliaWalletAddress, Blockchain.SEPOLIA);
  }
}