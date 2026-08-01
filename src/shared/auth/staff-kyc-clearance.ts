// Staff KYC clearance ALLOWlist — the inverse of the JWT denylists in ProcessService. Elevated
// endpoints (every `RoleGuard` whose entry roles are all in `KycGatedRoles`) require, on top of the
// role, that an identified natural person is behind the calling account: a non-empty `verifiedName`.
// That name is only ever set by an identity-verified path or a reviewed migration, never self-service,
// so it is the authoritative identification signal on its own — no KYC level is required.
// `StaffKycClearanceService` derives the cleared account (user data) ids from the DB into the
// `staffKycClearance` setting; `ProcessService` primes this Set from it, so revoking a staff member's
// clearance takes effect on live tokens within one refresh interval — no re-login, no JWT-secret rotation.
//
// Fail-CLOSED, unlike the denylists: a not-yet-primed or empty Set denies every elevated endpoint.
// That asymmetry is deliberate — a DB or cron outage must never silently re-open admin access — and
// it is why ProcessService awaits the first prime before HTTP starts, and why a failing resync keeps
// the last known Set rather than clearing it.
//
// Deliberately its own module rather than living next to the denylists in `process.service.ts`:
// RoleGuard is imported by nearly every controller, and importing ProcessService from it would pull
// `config.ts` (and with it the whole blockchain/node-pty dependency chain) into the auth path.
let StaffKycClearedAccounts: Set<number> = new Set();

export function HasStaffKycClearance(account: number | undefined): boolean {
  return account != null && StaffKycClearedAccounts.has(account);
}

// Only ProcessService should call this — the cron owns the lifecycle of the Set.
export function SetStaffKycClearance(accounts: number[]): void {
  StaffKycClearedAccounts = new Set(accounts);
}
