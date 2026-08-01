import {
  USER_PROFILE_ACCOUNT_FIELDS,
  USER_PROFILE_ORGANIZATION_ADDRESS_FIELDS,
  USER_PROFILE_PERSONAL_ADDRESS_FIELDS,
  USER_PROFILE_PROJECTION,
  UserDataRepository,
} from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDtoMapper } from 'src/subdomains/generic/user/models/user/dto/user-dto.mapper';
import { UserProfileDto } from 'src/subdomains/generic/user/models/user/dto/user-profile.dto';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { DataSource } from 'typeorm';

const SCHEMA = 'user_profile_projection_spec';

/**
 * `GET /user/profile` — the four levels from `docs/read-path-projections.md`.
 *
 * The endpoint answers a `UserProfileDto` built by `UserDtoMapper.mapProfile`. Reading it without a
 * projection loads 253 columns across 8 eager joins for the seven values it returns.
 *
 * The branch that makes this worth testing is `UserData.address`: for an organization account it
 * reads the address off `organization`, for a personal one off `userData` itself. A projection
 * covering only one of the two answers 200 with an empty address for the other.
 */
describeProjection('GET /user/profile — read-path projection', () => {
  let dataSource: DataSource;
  let repository: UserDataRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    repository = new UserDataRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /** Fully populated fixture: every column of every participating entity carries a non-empty value. */
  async function seedAccount(accountType: AccountType): Promise<UserData> {
    return seedEntity<UserData>(dataSource, UserData, {
      values: { accountType },
      relations: { country: true, organization: { relations: { country: true } } },
    });
  }

  /** A personal account with no organization linked — the branch where the join finds no row. */
  async function seedAccountWithoutOrganization(): Promise<UserData> {
    return seedEntity<UserData>(dataSource, UserData, {
      values: { accountType: AccountType.PERSONAL },
      relations: { country: true },
    });
  }

  /** The response the endpoint produces, through the projected query. */
  async function profileOf(id: number, fields = USER_PROFILE_PROJECTION.fields): Promise<UserProfileDto> {
    const userData = await repository.getProfile(id, fields);
    return UserDtoMapper.mapProfile(userData);
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a personal account answers with no empty field', async () => {
    const userData = await seedAccount(AccountType.PERSONAL);

    expectNoEmptyFields(await profileOf(userData.id));
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each([AccountType.ORGANIZATION, AccountType.SOLE_PROPRIETORSHIP])(
    'level 2 — %s reads the address off the organization and answers with no empty field',
    async (accountType) => {
      const userData = await seedAccount(accountType);

      const profile = await profileOf(userData.id);

      expectNoEmptyFields(profile);
    },
    120000,
  );

  it('level 2 — the address comes from a different source per account type', async () => {
    const personal = await seedAccount(AccountType.PERSONAL);
    const organization = await seedAccount(AccountType.ORGANIZATION);

    const personalProfile = await profileOf(personal.id);
    const organizationProfile = await profileOf(organization.id);

    // Both fixtures carry an organization, so the difference isolates the branch: the personal
    // account must answer with its own street, the organization one with the organization's. Had the
    // projection loaded only one of the two sources, one of these would be empty rather than merely
    // different — and the assertion holds because every seeded value is distinct.
    expect(personalProfile.address.street).toEqual(personal.street);
    expect(organizationProfile.address.street).toEqual(organization.organization.street);
    expect(personalProfile.address.street).not.toEqual(organizationProfile.address.street);
  }, 120000);

  it('level 2 — a personal account without an organization answers without one', async () => {
    const userData = await seedAccountWithoutOrganization();

    const profile = await profileOf(userData.id);

    // The ordinary case: no organization row, so the mapper has no name to report. Everything else
    // must still be complete — a projection that only ever ran against the fixture above would not
    // show whether the left joins tolerate the missing row.
    expect(profile.organizationName).toBeUndefined();
    expectNoEmptyFields(profile, ['organizationName']);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it.each([
    [AccountType.PERSONAL, [...USER_PROFILE_ACCOUNT_FIELDS, ...USER_PROFILE_PERSONAL_ADDRESS_FIELDS]],
    [AccountType.ORGANIZATION, [...USER_PROFILE_ACCOUNT_FIELDS, ...USER_PROFILE_ORGANIZATION_ADDRESS_FIELDS]],
  ])(
    'level 3 — for %s every field feeding the response is required',
    async (accountType, candidates) => {
      const userData = await seedAccount(accountType);

      // Drops each candidate in turn and re-runs the same production query with the rest of the
      // projection intact. Only the fields this account type actually reads are candidates: a personal
      // account never touches the organization address, so dropping it would prove nothing here — the
      // organization row above is what covers those.
      await expectEveryFieldRequired(candidates, (omitted) =>
        profileOf(userData.id, projectionFieldsWithout(USER_PROFILE_PROJECTION.fields, omitted)),
      );
    },
    300000,
  );

  // --- LEVEL 4: consistency against a second source --- //

  it.each([
    ['Personal', () => seedAccount(AccountType.PERSONAL)],
    ['Organization', () => seedAccount(AccountType.ORGANIZATION)],
    ['SoleProprietorship', () => seedAccount(AccountType.SOLE_PROPRIETORSHIP)],
    ['Personal without an organization', seedAccountWithoutOrganization],
  ])(
    'level 4 — for %s the projected response equals the one from a full load',
    async (_name, seed) => {
      const userData = await seed();

      const projected = await profileOf(userData.id);
      // The unprojected load is the second source: it fetches every column, so whatever it produces
      // is by construction what the endpoint answered before the conversion. No second
      // implementation is involved that could be wrong in the same way.
      const full = await dataSource.getRepository(UserData).findOne({
        where: { id: userData.id },
        relations: { organization: true },
      });

      expect(projected).toEqual(UserDtoMapper.mapProfile(full));
    },
    120000,
  );

  // --- the projection must not lose the guard the endpoint depends on --- //

  it('loads the status the endpoint refuses merged accounts on', async () => {
    const userData = await seedAccount(AccountType.PERSONAL);

    const loaded = await repository.getProfile(userData.id);

    expect(loaded.status).toEqual(userData.status);
  }, 120000);
});
