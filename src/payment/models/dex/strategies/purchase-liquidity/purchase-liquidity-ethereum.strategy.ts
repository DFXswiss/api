import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { PurchaseLiquidityEVMStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityEthereumStrategy extends PurchaseLiquidityEVMStrategy {
  constructor(mailService: MailService) {
    super(mailService);
  }
}
