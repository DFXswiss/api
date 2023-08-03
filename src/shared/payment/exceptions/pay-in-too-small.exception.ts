export class PayInTooSmallException extends Error {
  constructor(message?: string) {
    super(message);
  }
}
