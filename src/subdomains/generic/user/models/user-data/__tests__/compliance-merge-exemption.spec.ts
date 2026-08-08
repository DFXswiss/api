import { UserRole } from 'src/shared/auth/user-role.enum';
import { User } from '../../user/user.entity';
import { UserData } from '../user-data.entity';
import { KycType } from '../user-data.enum';

// The mail merge is the only self-service path by which a Compliance account can reach a
// `verifiedName`, and without one it loses every elevated endpoint under the staff-clearance rule
// (#4395 → #4572). These tests pin that the exemption is scoped to that path: the merges the system
// derives on its own (a matching IBAN, an ident document) stay blocked for Compliance accounts.
function buildUserData(id: number, role?: UserRole): UserData {
  return Object.assign(new UserData(), {
    id,
    kycType: KycType.DFX,
    users: role ? [Object.assign(new User(), { id, role })] : [],
  });
}

describe('UserData compliance merge exemption', () => {
  it('blocks a merge with a Compliance account by default', () => {
    const master = buildUserData(1);
    const slave = buildUserData(2, UserRole.COMPLIANCE);

    expect(() => master.checkIfMergePossibleWith(slave)).toThrow('Cannot merge compliance accounts');
    expect(master.isMergePossibleWith(slave)).toBe(false);
  });

  it('blocks it when the Compliance account is the master', () => {
    const master = buildUserData(1, UserRole.COMPLIANCE);
    const slave = buildUserData(2);

    expect(() => master.checkIfMergePossibleWith(slave)).toThrow('Cannot merge compliance accounts');
    expect(master.isMergePossibleWith(slave)).toBe(false);
  });

  it.each([
    ['slave', undefined, UserRole.COMPLIANCE],
    ['master', UserRole.COMPLIANCE, undefined],
    ['both sides', UserRole.COMPLIANCE, UserRole.COMPLIANCE],
  ])('allows the owner-initiated mail merge with a Compliance account as %s', (_side, masterRole, slaveRole) => {
    const master = buildUserData(1, masterRole);
    const slave = buildUserData(2, slaveRole);

    expect(() => master.checkIfMergePossibleWith(slave, true)).not.toThrow();
    expect(master.isMergePossibleWith(slave, true)).toBe(true);
  });

  it('keeps every other merge condition in force on the mail path', () => {
    const master = buildUserData(1, UserRole.COMPLIANCE);
    const slave = buildUserData(2, UserRole.COMPLIANCE);
    master.verifiedName = 'Alice Example';
    slave.verifiedName = 'Bob Different';

    // The exemption lifts the compliance block only — a verified-name conflict must still stop the
    // merge, or the mail path would become a way around the identity checks it exists to satisfy.
    expect(() => master.checkIfMergePossibleWith(slave, true)).toThrow('Verified name mismatch');
  });

  it('leaves accounts without a Compliance role unaffected in both modes', () => {
    const master = buildUserData(1);
    const slave = buildUserData(2);

    expect(() => master.checkIfMergePossibleWith(slave)).not.toThrow();
    expect(() => master.checkIfMergePossibleWith(slave, true)).not.toThrow();
  });
});
