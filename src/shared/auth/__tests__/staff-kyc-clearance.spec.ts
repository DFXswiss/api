import { HasStaffKycClearance, SetStaffKycClearance } from '../staff-kyc-clearance';

describe('staff KYC clearance', () => {
  // reset the shared module-level Set so state does not leak between tests
  afterEach(() => SetStaffKycClearance([]));

  it('clears an account id present in the primed list', () => {
    SetStaffKycClearance([123, 456]);

    expect(HasStaffKycClearance(123)).toBe(true);
    expect(HasStaffKycClearance(456)).toBe(true);
  });

  it('denies an account id not present in the list', () => {
    SetStaffKycClearance([123]);

    expect(HasStaffKycClearance(999)).toBe(false);
  });

  it('denies an undefined account', () => {
    SetStaffKycClearance([123]);

    expect(HasStaffKycClearance(undefined)).toBe(false);
  });

  // The inverse of the JWT denylist behaviour, and the point of the whole gate: no clearance data
  // means no elevated access, never the other way round.
  it('fails CLOSED before it is ever primed', () => {
    expect(HasStaffKycClearance(123)).toBe(false);
  });

  it('fails CLOSED on an empty list', () => {
    SetStaffKycClearance([]);

    expect(HasStaffKycClearance(123)).toBe(false);
  });

  it('revokes clearance as soon as an account drops out of the list', () => {
    SetStaffKycClearance([123]);
    expect(HasStaffKycClearance(123)).toBe(true);

    SetStaffKycClearance([]);

    expect(HasStaffKycClearance(123)).toBe(false);
  });
});
