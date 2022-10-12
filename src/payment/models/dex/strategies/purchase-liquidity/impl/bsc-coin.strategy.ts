import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  constructor(mailService: MailService, dexBscService: DexBscService) {
    super(mailService, dexBscService);
  }
}
