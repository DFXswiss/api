import { Injectable } from '@nestjs/common';
import { PayInBitcoinService } from '../../../services/payin-bitcoin.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { SendType } from './base/send.strategy';
import { CryptoInput } from '../../../entities/crypto-input.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JellyfishStrategy } from './base/jellyfish.strategy';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { FeeLimitExceededException } from 'src/shared/payment/exceptions/fee-limit-exceeded.exception';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

@Injectable()
export class BitcoinStrategy extends JellyfishStrategy {
  protected readonly logger = new DfxLogger(BitcoinStrategy);

  constructor(
    protected readonly bitcoinService: PayInBitcoinService,
    protected readonly payInRepo: PayInRepository,
    priceProvider: PriceProviderService,
    payoutService: PayoutService,
    transactionHelper: TransactionHelper,
  ) {
    super(bitcoinService, payInRepo, Blockchain.BITCOIN, priceProvider, payoutService, transactionHelper);
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (payIns.length === 0) return;

    this.logger.verbose(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} Bitcoin input(s): ${payIns.map(
        (p) => p.id,
      )}`,
    );

    await this.bitcoinService.checkHealthOrThrow();

    // assuming BTC is the only asset on Bitcoin
    const asset = payIns[0].asset;
    const { targetFee } = await this.getEstimatedFee(asset);
    const minInputFee = await this.getMinInputFee(asset);

    for (const payIn of payIns) {
      try {
        CryptoInput.verifyEstimatedFee(targetFee, minInputFee, payIn.amount);

        this.designateSend(payIn, type);
        const { outTxId, feeAmount } = await this.bitcoinService.sendUtxo(payIn);
        this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(logLevel, `Failed to send Bitcoin input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.default.btcOutput.address, Blockchain.BITCOIN);
  }

  protected async isConfirmed(payIn: CryptoInput): Promise<boolean> {
    const { confirmations } = await this.jellyfishService.getTx(payIn.inTxId);
    return confirmations >= 1;
  }
}
