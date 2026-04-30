// order failed - stop the pipeline
export class OrderFailedException extends Error {
  constructor(message: string) {
    super(message);
  }
}
