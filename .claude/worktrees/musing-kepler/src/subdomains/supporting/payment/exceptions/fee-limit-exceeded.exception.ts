export class FeeLimitExceededException extends Error {
  constructor(message: string) {
    super(message);
  }
}
