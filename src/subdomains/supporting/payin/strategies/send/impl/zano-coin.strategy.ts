import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInZanoService } from '../../../services/payin-zano.service';
import { ZanoStrategy } from './base/zano.strategy';

@Injectable()
export class ZanoCoinStrategy extends ZanoStrategy {
  protected readonly logger = new DfxLogger(ZanoCoinStrategy);

  constructor(
    readonly payInZanoService: PayInZanoService,
    readonly payInRepo: PayInRepository,
  ) {
    super(payInZanoService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return false;
  }
}
