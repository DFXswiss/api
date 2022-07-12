import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PreparePayoutCommand } from '../commands/prepare-payout.command';
import { DeFiChainPayoutService } from '../services/defichain/defichain-payout.service';

@CommandHandler(PreparePayoutCommand)
export class PreparePayoutHandler implements ICommandHandler<PreparePayoutCommand> {
  constructor(private readonly deFiChainPayoutService: DeFiChainPayoutService) {}

  async execute(command: PreparePayoutCommand) {
    const {
      payload: { asset, amount, destination },
    } = command;

    await this.deFiChainPayoutService.preparePayout({ asset, amount, destination }, command.correlationId);
  }
}
