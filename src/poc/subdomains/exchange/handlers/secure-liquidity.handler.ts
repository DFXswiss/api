import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { SecureLiquidityCommand } from '../commands/secure-liquidity.command';
import { DeFiChainDexLiquidityService } from '../services/defichain/defichain-dex-liquidity.service';
import { LiquiditySwapStrategy } from '../strategies/defichain/liquidity-swap.strategy';
import { NonReferenceLiquiditySwapStrategy } from '../strategies/defichain/non-ref-liquidity-swap.strategy';
import { ReferenceLiquiditySwapStrategy } from '../strategies/defichain/ref-liquidity-swap.strategy';

@CommandHandler(SecureLiquidityCommand)
export class SecureLiquidityHandler implements ICommandHandler<SecureLiquidityCommand> {
  readonly #strategies: Map<string, LiquiditySwapStrategy> = new Map();

  constructor(
    private readonly defichainDexLiquidityService: DeFiChainDexLiquidityService,
    readonly referenceLiquiditySwapStrategy: ReferenceLiquiditySwapStrategy,
    readonly nonReferenceLiquiditySwapStrategy: NonReferenceLiquiditySwapStrategy,
  ) {
    this.#strategies.set('referenceAsset', referenceLiquiditySwapStrategy);
    this.#strategies.set('nonReferenceAsset', nonReferenceLiquiditySwapStrategy);
  }

  async execute(command: SecureLiquidityCommand) {
    const success = await this.defichainDexLiquidityService.checkAvailableLiquidity(
      command.payload,
      command.correlationId,
    );

    if (success) return;

    const swapRequest = { amount: command.payload.referenceAmount, asset: command.payload.referenceAsset };

    const isReferenceAsset =
      command.payload.referenceAsset === 'BTC' ||
      command.payload.referenceAsset === 'USDC' ||
      command.payload.referenceAsset === 'USDT';

    let swapAmount: number;

    if (isReferenceAsset) {
      swapAmount = await this.#strategies.get('referenceAsset').calculateLiquiditySwapAmount(swapRequest);
    } else {
      swapAmount = await this.#strategies.get('nonReferenceAsset').calculateLiquiditySwapAmount(swapRequest);
    }

    await this.defichainDexLiquidityService.purchaseLiquidity(
      swapAmount,
      command.payload.targetAsset,
      command.correlationId,
    );
  }
}
