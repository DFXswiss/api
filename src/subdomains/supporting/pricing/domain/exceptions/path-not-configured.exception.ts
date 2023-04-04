export class PathNotConfiguredException extends Error {
  constructor(from: string, to: string) {
    super(`Pricing path is not configured for pair from: ${from} to: ${to} `);
  }
}
