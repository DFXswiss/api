import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInGnosisService } from '../../../services/payin-gnosis.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class GnosisCoinStrategy extends EvmCoinStrategy {
  constructor(gnosisService: PayInGnosisService, payInRepo: PayInRepository) {
    super(gnosisService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.gnosis.gnosisWalletAddress, Blockchain.GNOSIS);
  }
}
