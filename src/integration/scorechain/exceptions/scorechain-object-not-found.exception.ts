// Thrown when Scorechain has no record of the screened object — an HTTP 404 whose body reports a
// NOT_FOUND_* error (e.g. a withdrawal target address that has never appeared on-chain). This is an
// expected screening outcome, not a provider outage, so callers translate it into a NotFound verdict
// (fail-closed → high risk) instead of failing the whole request.
export class ScorechainObjectNotFoundException extends Error {
  constructor(url: string) {
    super(`Scorechain has no record of the requested object: POST ${url}`);
    this.name = ScorechainObjectNotFoundException.name;
  }
}
