export class OrderNotProcessableException extends Error {
  constructor(message: string) {
    super(message);
  }
}
