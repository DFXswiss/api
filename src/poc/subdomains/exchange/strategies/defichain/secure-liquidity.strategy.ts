import { SecureLiquidityCommand } from '../../commands/secure-liquidity.command';

export abstract class SecureLiquidityStrategy {
  abstract secureLiquidity(command: SecureLiquidityCommand): Promise<void>;
}
