import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../services/dex-bsc.service';
import { PurchaseLiquidityEvmTokenStrategy } from './base/purchase-liquidity-evm-token.strategy';

@Injectable()
export class PurchaseLiquidityBscTokenStrategy extends PurchaseLiquidityEvmTokenStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
