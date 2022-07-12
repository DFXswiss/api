import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DoPayoutCommand } from '../commands/do-payout.command';
import { DeFiChainPayoutService } from '../services/defichain/defichain-payout.service';
import { DoPayoutStrategy } from '../strategies/defichain/do-payout.strategy';
import { PayoutDFIStrategy } from '../strategies/defichain/payout-dfi.strategy';
import { PayoutTokenStrategy } from '../strategies/defichain/payout-token.strategy';

@CommandHandler(DoPayoutCommand)
export class DoPayoutHandler implements ICommandHandler<DoPayoutCommand> {
  readonly #strategies: Map<string, DoPayoutStrategy> = new Map();

  constructor(
    private readonly deFiChainPayoutService: DeFiChainPayoutService,
    readonly payoutDFIStrategy: PayoutDFIStrategy,
    readonly payoutTokenStrategy: PayoutTokenStrategy,
  ) {
    this.#strategies.set('DFI', payoutDFIStrategy);
    this.#strategies.set('Token', payoutTokenStrategy);
  }

  async execute(command: DoPayoutCommand) {
    const order = await this.deFiChainPayoutService.getOrder(command.payload.payoutOrderId);

    if (order.asset === 'DFI') {
      await this.#strategies.get('DFI').doPayout(order);
    } else {
      await this.#strategies.get('Token').doPayout(order);
    }
  }
}
