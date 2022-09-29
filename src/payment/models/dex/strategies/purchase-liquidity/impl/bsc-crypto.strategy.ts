import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmCryptoStrategy } from './base/evm-crypto.strategy';

@Injectable()
export class BscCryptoStrategy extends EvmCryptoStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
