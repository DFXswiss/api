import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexEthereumService } from '../../services/dex-ethereum.service';
import { PurchaseLiquidityEVMStrategy } from './base/purchase-liquidity-evm.strategy';

@Injectable()
export class PurchaseLiquidityEthereumStrategy extends PurchaseLiquidityEVMStrategy {
  constructor(mailService: MailService, dexEthereumService: DexEthereumService) {
    super(mailService, dexEthereumService);
  }
}
