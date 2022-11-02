export class PathMisconfiguredException extends Error {
  constructor(message: string) {
    super(`PricePath init specification is not satisfied: ${message}`);
  }
}
