import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { Util } from 'src/shared/utils/util';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInEvmService } from 'src/subdomains/supporting/payin/services/base/payin-evm.service';
import { EvmStrategy } from './evm.strategy';
import { SendGroup } from './send.strategy';

export abstract class EvmTokenStrategy extends EvmStrategy {
  constructor(
    protected readonly payInEvmService: PayInEvmService,
    protected readonly payInRepo: PayInRepository,
    protected readonly evmRegistryService: EvmRegistryService,
  ) {
    super(payInEvmService, payInRepo, evmRegistryService);
  }

  protected async checkPreparation(payInGroup: SendGroup): Promise<boolean> {
    const result = [];
    /**
     * @note
     * should be only one transaction for group, but with very low probability can be more
     */
    const prepareTxIds = [...new Set(payInGroup.payIns.map((p) => p.prepareTxId))];

    for (const txId of prepareTxIds) {
      result.push(await this.payInEvmService.checkTransactionCompletion(txId));
    }

    return result.every((tsStatus) => !!tsStatus);
  }

  protected async prepareSend(payInGroup: SendGroup, nativeFee: number): Promise<void> {
    // small cap for gas price changes
    const prepareTxId = await this.topUpCoin(payInGroup, Util.round(nativeFee * 1.1, 12));

    for (const payIn of payInGroup.payIns) {
      payIn.preparing(prepareTxId, Util.round(nativeFee / payInGroup.payIns.length, 16));
      await this.payInRepo.save(payIn);
    }
  }

  protected dispatchSend(payInGroup: SendGroup, estimatedNativeFee: number): Promise<string> {
    const { account, destinationAddress, asset } = payInGroup;

    return this.payInEvmService.sendToken(
      account,
      destinationAddress,
      asset,
      this.getTotalGroupAmount(payInGroup),
      estimatedNativeFee,
    );
  }
}
