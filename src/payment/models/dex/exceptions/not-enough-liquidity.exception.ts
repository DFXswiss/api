export class NotEnoughLiquidityException extends Error {
  constructor(message: string) {
    super(message);
  }
}
