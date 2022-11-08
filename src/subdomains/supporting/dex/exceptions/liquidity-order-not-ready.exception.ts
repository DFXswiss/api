export class LiquidityOrderNotReadyException extends Error {
  constructor(message: string) {
    super(message);
  }
}
