import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { SecureLiquidityCommand } from '../commands/secure-liquidity.command';
import { SecureLiquidityStrategy } from '../strategies/defichain/secure-liquidity.strategy';
import { SecureNonReferenceLiquidityStrategy } from '../strategies/secure-non-ref-liquidity.strategy';
import { SecureReferenceAssetLiquidityStrategy } from '../strategies/secure-ref-liquidity.strategy';

@CommandHandler(SecureLiquidityCommand)
export class SecureLiquidityHandler implements ICommandHandler<SecureLiquidityCommand> {
  readonly #strategies: Map<string, SecureLiquidityStrategy> = new Map();

  constructor(
    readonly secureReferenceAssetLiquidityStrategy: SecureReferenceAssetLiquidityStrategy,
    readonly secureNonReferenceLiquidityStrategy: SecureNonReferenceLiquidityStrategy,
  ) {
    this.#strategies.set('referenceAsset', secureReferenceAssetLiquidityStrategy);
    this.#strategies.set('nonReferenceAsset', secureNonReferenceLiquidityStrategy);
  }

  async execute(command: SecureLiquidityCommand) {
    const isReferenceAsset =
      command.payload.referenceAsset === 'BTC' ||
      command.payload.referenceAsset === 'USDC' ||
      command.payload.referenceAsset === 'USDT';

    if (isReferenceAsset) {
      await this.#strategies.get('referenceAsset').secureLiquidity(command);
    } else {
      await this.#strategies.get('nonReferenceAsset').secureLiquidity(command);
    }
  }
}
