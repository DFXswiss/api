import { Injectable, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInCitreaTestnetService } from '../../../services/payin-citrea-testnet.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class CitreaTestnetStrategy extends EvmStrategy implements OnModuleInit {
  protected readonly logger = new DfxLogger(CitreaTestnetStrategy);

  constructor(citreaTestnetService: PayInCitreaTestnetService) {
    super(citreaTestnetService);
  }

  onModuleInit() {
    super.onModuleInit();

    this.addressWebhookMessageQueue = new QueueHandler();
    this.assetTransfersMessageQueue = new QueueHandler();

    // CitreaTestnet uses Goldsky instead of Alchemy for transaction monitoring
    // Webhook subscriptions are not yet implemented for this network
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA_TESTNET;
  }

  //*** HELPER METHODS ***//

  /**
   * @note
   * this is needed to skip registering inputs from own address
   * cannot be filtered as a dust input, because fees can go high
   */
  protected getOwnAddresses(): string[] {
    const citreaConfig = Config.blockchain.citreaTestnet;
    if (!citreaConfig || !citreaConfig.citreaTestnetWalletAddress) {
      throw new Error('CitreaTestnet configuration is missing. CITREA_TESTNET_WALLET_ADDRESS must be configured.');
    }
    return [citreaConfig.citreaTestnetWalletAddress];
  }
}