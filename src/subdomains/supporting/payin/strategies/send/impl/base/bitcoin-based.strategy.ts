import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger, LogLevel } from 'src/shared/services/dfx-logger';
import { PayInBitcoinBasedService } from 'src/subdomains/supporting/payin/services/base/payin-bitcoin-based.service';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { CryptoInput, PayInConfirmationType } from '../../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../../repositories/payin.repository';
import { SendStrategy, SendType } from './send.strategy';

export abstract class BitcoinBasedStrategy extends SendStrategy {
  protected abstract readonly logger: DfxLogger;

  constructor(
    protected readonly payInService: PayInBitcoinBasedService,
    protected readonly payInRepo: PayInRepository,
  ) {
    super();
  }

  protected abstract getForwardAddress(): BlockchainAddress;
  protected abstract checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean>;

  get blockchain(): Blockchain {
    return Blockchain.BITCOIN;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async doSend(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (payIns.length === 0) return;

    this.logger.verbose(
      `${type === SendType.FORWARD ? 'Forwarding' : 'Returning'} ${payIns.length} ${
        this.blockchain
      } input(s): ${payIns.map((p) => p.id)}`,
    );

    await this.payInService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        this.designateSend(payIn, type);

        const { feeInputAsset: fee, maxFeeInputAsset: maxFee } = await this.getEstimatedForwardFee(
          payIn.asset,
          payIn.amount,
          payIn.destinationAddress.address,
        );

        CryptoInput.verifyForwardFee(fee, payIn.maxForwardFee, maxFee, payIn.amount);

        const { outTxId, feeAmount } = await this.payInService.sendTransfer(payIn);
        await this.updatePayInWithSendData(payIn, type, outTxId, feeAmount);

        await this.payInRepo.save(payIn);
      } catch (e) {
        if (e.message.includes('No maximum fee provided')) continue;

        const logLevel = e instanceof FeeLimitExceededException ? LogLevel.INFO : LogLevel.ERROR;

        this.logger.log(logLevel, `Failed to send ${this.blockchain} input ${payIn.id} of type ${type}:`, e);
      }
    }
  }

  async checkConfirmations(payIns: CryptoInput[], direction: PayInConfirmationType): Promise<void> {
    await this.payInService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        if (!payIn.confirmationTxId(direction)) continue;

        const minConfirmations = await this.getMinConfirmations(payIn, direction);

        const isConfirmed = await this.checkTransactionCompletion(payIn.confirmationTxId(direction), minConfirmations);
        if (isConfirmed) {
          payIn.confirm(direction, this.forwardRequired);

          await this.payInRepo.save(payIn);
        }
      } catch (e) {
        this.logger.error(`Failed to check confirmations of ${this.blockchain} input ${payIn.id}:`, e);
      }
    }
  }

  async doSendFromLiquidity(payIns: CryptoInput[], type: SendType): Promise<void> {
    if (type !== SendType.RETURN) {
      throw new Error('doSendFromLiquidity only supports RETURN type');
    }

    await this.payInService.checkHealthOrThrow();

    for (const payIn of payIns) {
      try {
        const returnTxId = await this.sendReturnFromLiquidity(payIn);

        payIn.pendingReturnFromLiquidity(returnTxId);
        await this.payInRepo.save(payIn);

        this.logger.verbose(`Returned pay-in ${payIn.id} from liquidity, txId: ${returnTxId}`);
      } catch (e) {
        this.logger.error(`Failed to return ${this.blockchain} pay-in ${payIn.id} from liquidity:`, e);
        // Status remains TO_RETURN_FROM_LIQ, retry in next cron iteration
        continue;
      }
    }
  }

  protected abstract sendReturnFromLiquidity(payIn: CryptoInput): Promise<string>;
}
