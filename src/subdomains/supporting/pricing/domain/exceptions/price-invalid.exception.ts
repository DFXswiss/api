export class PriceInvalidException extends Error {
  constructor(message: string) {
    super(message);
  }
}
