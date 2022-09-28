import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { PurchaseLiquidityEvmTokenStrategy } from './base/purchase-liquidity-evm-token.strategy';

@Injectable()
export class PurchaseLiquidityEthereumTokenStrategy extends PurchaseLiquidityEvmTokenStrategy {
  constructor(mailService: MailService, dexEthereumService: DexEthereumService) {
    super(mailService, dexEthereumService);
  }
}
