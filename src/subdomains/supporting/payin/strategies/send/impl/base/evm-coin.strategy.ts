import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Util } from 'src/shared/utils/util';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup } from './send.strategy';

export abstract class EvmCoinStrategy extends EvmStrategy {
  constructor(
    protected readonly dexService: DexService,
    protected readonly payoutService: PayoutService,
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly blockchain: Blockchain,
  ) {
    super(dexService, payoutService, payInEvmService, payInRepo, blockchain);
  }

  protected async checkPreparation(_: SendGroup): Promise<boolean> {
    /**
     * @note
     * prepared by default, because fee is subtracted from sent amount
     */
    return true;
  }

  protected async prepareSend(payInGroup: SendGroup, nativeFee: number): Promise<void> {
    for (const payIn of payInGroup.payIns) {
      payIn.preparing(null, Util.round(nativeFee / payInGroup.payIns.length, 16));
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string> {
    const { sourceAddress, privateKey, destinationAddress } = payInGroup;

    return this.payInEvmService.sendNativeCoin(
      sourceAddress,
      privateKey,
      destinationAddress,
      /**
       * @note
       * subtracting a fraction more from sent amount to compensate possible rounding issues.
       * */
      Util.round(this.getTotalGroupAmount(payInGroup) - estimatedNativeFee * 1.00001, 12),
      estimatedNativeFee,
    );
  }
}
