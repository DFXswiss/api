import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { LiquidityManagementSystem } from '../../enums';
import { CcxtExchangeAdapter } from './base/ccxt-exchange.adapter';

@Injectable()
export class KrakenAdapter extends CcxtExchangeAdapter {
  constructor(krakenService: KrakenService, dexService: DexService) {
    super(LiquidityManagementSystem.KRAKEN, krakenService, dexService);
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
