import { ForbiddenException } from '@nestjs/common';

// Answer for a staff caller who holds the role but is not KYC-cleared (see `HasStaffKycClearance`).
// A bare `false` from the guard would produce the generic "Forbidden resource", which is
// indistinguishable from "your role was removed" — leaving the caller, and any tooling in front of
// it, with no way to tell that the fix is to complete an identification. The machine-readable `code`
// follows the existing `TFA_REQUIRED` pattern so clients can branch on it instead of matching text.
export class StaffKycRequiredException extends ForbiddenException {
  constructor() {
    super({
      code: 'STAFF_KYC_REQUIRED',
      message: 'Staff access requires a completed identification: KYC level 50 and a verified name on your account',
    });
  }
}
