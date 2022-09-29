import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCryptoStrategy } from './base/evm-crypto.strategy';

@Injectable()
export class EthereumCryptoStrategy extends EvmCryptoStrategy {
  constructor(mailService: MailService, dexEthereumService: DexEthereumService) {
    super(mailService, dexEthereumService);
  }
}
