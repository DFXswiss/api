import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInEthereumService } from '../../../services/payin-ethereum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

@Injectable()
export class EthereumCoinStrategy extends EvmCoinStrategy {
  constructor(
    protected readonly ethereumService: PayInEthereumService,
    payInRepo: PayInRepository,
    priceProvider: PriceProviderService,
    payoutService: PayoutService,
    transactionHelper: TransactionHelper,
  ) {
    super(ethereumService, payInRepo, Blockchain.ETHEREUM, priceProvider, payoutService, transactionHelper);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.ethereum.ethWalletAddress, Blockchain.ETHEREUM);
  }
}
