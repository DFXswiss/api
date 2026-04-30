// order currently not processable - pipeline should continue with next step
export class OrderNotProcessableException extends Error {
  constructor(message: string) {
    super(message);
  }
}
