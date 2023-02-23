import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class BinanceAdapter extends CcxtExchangeAdapter {
  constructor(binanceService: BinanceService, dexService: DexService) {
    super(LiquidityManagementSystem.BINANCE, binanceService, dexService);
  }

  protected mapBlockchainToCcxtNetwork(blockchain: Blockchain): string {
    switch (blockchain) {
      case Blockchain.ARBITRUM:
        return 'arbitrum';

      case Blockchain.BINANCE_SMART_CHAIN:
        return 'bsc';

      case Blockchain.BITCOIN:
        return 'bitcoin';

      case Blockchain.CARDANO:
        return 'cardano';

      case Blockchain.DEFICHAIN:
        return 'defichain';

      case Blockchain.ETHEREUM:
        return 'ethereum';

      case Blockchain.OPTIMISM:
        return 'optimism';

      case Blockchain.POLYGON:
        return 'polygon';

      default:
        return null;
    }
  }
}
