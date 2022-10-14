import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  constructor(mailService: MailService, dexEthereumService: DexEthereumService) {
    super(mailService, dexEthereumService);
  }
}
