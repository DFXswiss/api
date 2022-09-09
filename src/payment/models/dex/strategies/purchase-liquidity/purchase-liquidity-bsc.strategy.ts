import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../services/dex-bsc.service';
import { PurchaseLiquidityEvmStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityBscStrategy extends PurchaseLiquidityEvmStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
