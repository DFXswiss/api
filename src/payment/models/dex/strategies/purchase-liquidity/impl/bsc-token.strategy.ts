import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
