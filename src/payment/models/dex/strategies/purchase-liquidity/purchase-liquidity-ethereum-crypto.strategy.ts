import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { PurchaseLiquidityEvmCryptoStrategy } from './base/purchase-liquidity-evm-crypto.strategy';

@Injectable()
export class PurchaseLiquidityEthereumCryptoStrategy extends PurchaseLiquidityEvmCryptoStrategy {
  constructor(mailService: MailService, dexEthereumService: DexEthereumService) {
    super(mailService, dexEthereumService);
  }
}
