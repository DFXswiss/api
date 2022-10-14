import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmTokenStrategy } from './base/evm-token.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmTokenStrategy {
  constructor(notificationService: NotificationService, dexEthereumService: DexEthereumService) {
    super(notificationService, dexEthereumService);
  }
}
