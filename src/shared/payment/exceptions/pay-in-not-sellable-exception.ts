export class PayInNotSellableException extends Error {
  constructor(message?: string) {
    super(message);
  }
}
