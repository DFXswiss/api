import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../services/dex-bsc.service';
import { PurchaseLiquidityEvmCryptoStrategy } from './base/purchase-liquidity-evm-crypto.strategy';

@Injectable()
export class PurchaseLiquidityBscCryptoStrategy extends PurchaseLiquidityEvmCryptoStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
