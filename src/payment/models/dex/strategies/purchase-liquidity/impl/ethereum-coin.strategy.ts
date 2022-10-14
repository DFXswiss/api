import { Injectable } from '@nestjs/common';
import { NotificationService } from 'src/notification/services/notification.service';
import { DexEthereumService } from '../../../services/dex-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(notificationService: NotificationService, dexEthereumService: DexEthereumService) {
    super(notificationService, dexEthereumService);
  }
}
