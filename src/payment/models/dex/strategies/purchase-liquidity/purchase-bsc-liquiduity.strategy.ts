import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { PurchaseETHBaseLiquidityStrategy } from './purchase-eth-base-liquiduity.strategy';

@Injectable()
export class PurchaseBSCLiquidityStrategy extends PurchaseETHBaseLiquidityStrategy {
  constructor(mailService: MailService) {
    super(mailService);
  }
}
