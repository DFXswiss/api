import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBSCService } from '../../services/dex-bsc.service';
import { PurchaseLiquidityEVMStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityBSCStrategy extends PurchaseLiquidityEVMStrategy {
  constructor(mailService: MailService, dexBscService: DexBSCService) {
    super(mailService, dexBscService);
  }
}
