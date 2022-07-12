import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { DoPayoutCommand } from '../commands/do-payout.command';
import { DoPayoutStrategy } from '../strategies/common/do-payout.strategy';
import { PayoutDFIStrategy } from '../strategies/payout-dfi.strategy';
import { PayoutTokenStrategy } from '../strategies/payout-token.strategy';

@CommandHandler(DoPayoutCommand)
export class DoPayoutHandler implements ICommandHandler<DoPayoutCommand> {
  readonly #strategies: Map<string, DoPayoutStrategy> = new Map();

  constructor(readonly payoutDFIStrategy: PayoutDFIStrategy, readonly payoutTokenStrategy: PayoutTokenStrategy) {
    this.#strategies.set('DFI', payoutDFIStrategy);
    this.#strategies.set('Token', payoutTokenStrategy);
  }

  async execute(command: DoPayoutCommand) {
    if (command.tx.outputAsset === 'DFI') {
      await this.#strategies.get('DFI').doPayout(command.tx);
    } else {
      await this.#strategies.get('Token').doPayout(command.tx);
    }
  }
}
