// order not necessary - requirements already fulfilled
export class OrderNotNecessaryException extends Error {
  constructor(message: string) {
    super(message);
  }
}
