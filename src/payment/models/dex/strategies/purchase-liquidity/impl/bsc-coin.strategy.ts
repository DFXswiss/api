import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { DexBscService } from '../../../services/dex-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  constructor(notificationService: NotificationService, dexBscService: DexBscService) {
    super(notificationService, dexBscService);
  }
}
