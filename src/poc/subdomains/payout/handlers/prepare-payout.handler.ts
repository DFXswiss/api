import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { Config } from 'src/config/config';
import { PreparePayoutCommand } from '../commands/prepare-payout.command';
import { PayoutPreparedEvent } from '../events/payout-prepared.event';

@CommandHandler(PreparePayoutCommand)
export class PreparePayoutHandler implements ICommandHandler<PreparePayoutCommand> {
  private dexClient: NodeClient;

  constructor(readonly nodeService: NodeService, private readonly eventBus: EventBus) {
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async execute(command: PreparePayoutCommand) {
    const txId = await this.dexClient.sendToken(
      Config.node.dexWalletAddress,
      Config.node.outWalletAddress,
      command.payload.asset,
      command.payload.amount,
    );

    // loop to wait for tx to complete then send PayoutPreparedEvent
    console.log('Prepared payout', txId);
    this.eventBus.publish(new PayoutPreparedEvent(command.correlationId));
  }
}
