export class InvalidPayoutAmountException extends Error {
  constructor(message: string) {
    super(message);
  }
}
