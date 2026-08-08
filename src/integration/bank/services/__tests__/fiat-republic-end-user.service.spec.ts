import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { DataSource, EntityManager } from 'typeorm';
import { FiatRepublicEndUserStatus, FiatRepublicPerson } from '../../dto/fiat-republic.dto';
import { FiatRepublicEndUser, FiatRepublicEndUserState } from '../../entities/fiat-republic-end-user.entity';
import { FiatRepublicEndUserRepository } from '../../repositories/fiat-republic-end-user.repository';
import { FiatRepublicEndUserService } from '../fiat-republic-end-user.service';
import { FiatRepublicNotCreatedError, FiatRepublicService } from '../fiat-republic.service';

const PERSON: FiatRepublicPerson = {
  firstName: 'Synthetic',
  lastName: 'Person',
  email: 'synthetic@example.com',
  dob: '1990-01-01',
  address: { line1: 'Street 1', city: 'City', postalCode: '0000', country: 'DE' },
};

function claimRow(overrides: Partial<FiatRepublicEndUser> = {}): FiatRepublicEndUser {
  return Object.assign(new FiatRepublicEndUser(), {
    id: 7,
    userDataId: 42,
    state: FiatRepublicEndUserState.PENDING,
    endUserId: null,
    error: null,
    ...overrides,
  });
}

function endUserResponse(overrides = {}) {
  return {
    id: 'eus_synthetic',
    person: PERSON,
    status: FiatRepublicEndUserStatus.ACTIVE,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('FiatRepublicEndUserService', () => {
  let service: FiatRepublicEndUserService;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let endUserRepo: DeepMocked<FiatRepublicEndUserRepository>;
  let dataSource: DeepMocked<DataSource>;
  let manager: DeepMocked<EntityManager>;
  let stored: FiatRepublicEndUser;

  beforeEach(async () => {
    fiatRepublicService = createMock<FiatRepublicService>();
    endUserRepo = createMock<FiatRepublicEndUserRepository>();
    manager = createMock<EntityManager>();
    dataSource = createMock<DataSource>();

    stored = claimRow();
    manager.query.mockResolvedValue([]);
    manager.findOne.mockImplementation(async () => stored);
    manager.save.mockImplementation(async (entity) => entity as never);
    dataSource.transaction.mockImplementation(async (cb: never) => (cb as (m: EntityManager) => unknown)(manager));

    jest.spyOn(fiatRepublicService, 'isFrontendEnabled').mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatRepublicEndUserService,
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: FiatRepublicEndUserRepository, useValue: endUserRepo },
        { provide: DataSource, useValue: dataSource },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatRepublicEndUserService>(FiatRepublicEndUserService);
  });

  afterEach(() => {
    Config.bank.fiatRepublic.frontendEnabled = false;
    jest.restoreAllMocks();
  });

  it('refuses to touch Fiat Republic while the frontend stage is not released', async () => {
    jest.spyOn(fiatRepublicService, 'isFrontendEnabled').mockReturnValue(false);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(fiatRepublicService.createIndividualEndUser).not.toHaveBeenCalled();
  });

  it('returns an already completed end user without calling Fiat Republic', async () => {
    stored = claimRow({ state: FiatRepublicEndUserState.COMPLETED, endUserId: 'eus_existing' });

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_existing');
    expect(fiatRepublicService.createIndividualEndUser).not.toHaveBeenCalled();
  });

  it('claims the row under an advisory lock before calling Fiat Republic', async () => {
    fiatRepublicService.createIndividualEndUser.mockResolvedValue(endUserResponse() as never);

    await service.getOrCreateEndUser(42, PERSON, '203.0.113.1');

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
      'fiat-republic-end-user',
      '42',
    ]);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT DO NOTHING'), [
      42,
      FiatRepublicEndUserState.PENDING,
    ]);
    expect(manager.save).toHaveBeenCalledWith(expect.objectContaining({ state: FiatRepublicEndUserState.IN_FLIGHT }));
  });

  it('creates the end user and completes the claim', async () => {
    fiatRepublicService.createIndividualEndUser.mockResolvedValue(endUserResponse() as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_synthetic');
    expect(fiatRepublicService.createIndividualEndUser).toHaveBeenCalledWith({
      person: PERSON,
      ipAddress: '203.0.113.1',
    });
    expect(endUserRepo.update).toHaveBeenCalledWith(7, {
      endUserId: 'eus_synthetic',
      state: FiatRepublicEndUserState.COMPLETED,
      error: null,
    });
  });

  it('throws when the claim row cannot be read back after the insert', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toThrow('claim missing after insert');
  });

  it('releases the claim on a deterministic rejection so a corrected retry can take it', async () => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(new FiatRepublicNotCreatedError('rejected'));

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(endUserRepo.update).toHaveBeenCalledWith(7, {
      state: FiatRepublicEndUserState.PENDING,
      error: 'Fiat Republic end user create rejected',
    });
    expect(fiatRepublicService.listIndividualEndUsersByEmail).not.toHaveBeenCalled();
  });

  it('adopts the end user found by the recovery listing after an ambiguous failure', async () => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(new Error('gateway timeout'));
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue([endUserResponse()] as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_synthetic');
    expect(fiatRepublicService.createIndividualEndUser).toHaveBeenCalledTimes(1);
  });

  it('matches the recovery candidate case-insensitively on e-mail', async () => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(new Error('gateway timeout'));
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue([
      endUserResponse({ person: { ...PERSON, email: 'SYNTHETIC@EXAMPLE.COM' } }),
    ] as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_synthetic');
  });

  it.each([
    ['an empty listing', []],
    ['a different date of birth', [endUserResponse({ person: { ...PERSON, dob: '1980-02-02' } })]],
    ['a different e-mail', [endUserResponse({ person: { ...PERSON, email: 'other@example.com' } })]],
    ['a candidate without an id', [endUserResponse({ id: undefined })]],
    ['a rejected candidate', [endUserResponse({ status: FiatRepublicEndUserStatus.REJECTED })]],
    ['a closed candidate', [endUserResponse({ status: FiatRepublicEndUserStatus.CLOSED })]],
    ['a suspended candidate', [endUserResponse({ status: FiatRepublicEndUserStatus.SUSPENDED })]],
    ['two live candidates', [endUserResponse(), endUserResponse({ id: 'eus_second' })]],
    ['a null listing', undefined],
  ])('fails closed and never issues a second create on %s', async (_name, listing) => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(new Error('gateway timeout'));
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue(listing as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fiatRepublicService.createIndividualEndUser).toHaveBeenCalledTimes(1);
    // The claim stays in flight — never reset to Pending, which would allow a second create.
    expect(endUserRepo.update).not.toHaveBeenCalledWith(7, expect.objectContaining({ state: 'Pending' }));
  });

  it.each([
    ['a non-Error create failure', 'not an error'],
    ['a non-Error listing failure', undefined],
  ])('fails closed on %s without re-creating', async (_name, thrown) => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(thrown ?? 'not an error');
    fiatRepublicService.listIndividualEndUsersByEmail.mockRejectedValue('not an error');

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fiatRepublicService.createIndividualEndUser).toHaveBeenCalledTimes(1);
  });

  it('leaves the claim in flight when a non-Error create failure finds nothing', async () => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue('not an error');
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue([] as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed when the recovery listing itself fails', async () => {
    fiatRepublicService.createIndividualEndUser.mockRejectedValue(new Error('gateway timeout'));
    fiatRepublicService.listIndividualEndUsersByEmail.mockRejectedValue(new Error('listing down'));

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('recovers instead of creating when a previous attempt left the claim in flight', async () => {
    stored = claimRow({ state: FiatRepublicEndUserState.IN_FLIGHT });
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue([endUserResponse()] as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_synthetic');
    expect(fiatRepublicService.createIndividualEndUser).not.toHaveBeenCalled();
  });

  it('refuses a claim that was permanently failed', async () => {
    stored = claimRow({ state: FiatRepublicEndUserState.FAILED, error: 'previous failure' });

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fiatRepublicService.listIndividualEndUsersByEmail).not.toHaveBeenCalled();
  });

  it('recovers a completed claim whose end user id never landed', async () => {
    stored = claimRow({ state: FiatRepublicEndUserState.COMPLETED, endUserId: null });
    fiatRepublicService.listIndividualEndUsersByEmail.mockResolvedValue([endUserResponse()] as never);

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).resolves.toBe('eus_synthetic');
    expect(fiatRepublicService.createIndividualEndUser).not.toHaveBeenCalled();
  });

  it('permanently fails the claim when Fiat Republic returns an unusable end user', async () => {
    fiatRepublicService.createIndividualEndUser.mockResolvedValue(
      endUserResponse({ status: FiatRepublicEndUserStatus.REJECTED }) as never,
    );

    await expect(service.getOrCreateEndUser(42, PERSON, '203.0.113.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(endUserRepo.update).toHaveBeenCalledWith(7, {
      state: FiatRepublicEndUserState.FAILED,
      error: `Fiat Republic end user is ${FiatRepublicEndUserStatus.REJECTED}`,
    });
  });

  describe('findEndUserId', () => {
    it('returns the id of a usable end user', async () => {
      endUserRepo.findOneBy.mockResolvedValue(
        claimRow({ state: FiatRepublicEndUserState.COMPLETED, endUserId: 'eus_existing' }),
      );

      await expect(service.findEndUserId(42)).resolves.toBe('eus_existing');
    });

    it.each([
      ['no row', null],
      ['an in-flight row', claimRow({ state: FiatRepublicEndUserState.IN_FLIGHT })],
      ['a completed row without an id', claimRow({ state: FiatRepublicEndUserState.COMPLETED, endUserId: null })],
    ])('returns undefined for %s', async (_name, row) => {
      endUserRepo.findOneBy.mockResolvedValue(row);

      await expect(service.findEndUserId(42)).resolves.toBeUndefined();
    });

    it('never creates anything', async () => {
      endUserRepo.findOneBy.mockResolvedValue(null);

      await service.findEndUserId(42);

      expect(fiatRepublicService.createIndividualEndUser).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
