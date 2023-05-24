import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

@Injectable()
export class OptimismCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly optimismService: PayInOptimismService,
    protected readonly assetService: AssetService,
    payInRepo: PayInRepository,
    priceProvider: PriceProviderService,
    payoutService: PayoutService,
    transactionHelper: TransactionHelper,
  ) {
    super(optimismService, payInRepo, Blockchain.OPTIMISM, priceProvider, payoutService, transactionHelper);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.optimism.optimismWalletAddress, Blockchain.OPTIMISM);
  }
}
