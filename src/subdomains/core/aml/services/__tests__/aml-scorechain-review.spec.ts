import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  ScorechainScreening,
  ScorechainScreeningContext,
} from 'src/integration/scorechain/entities/scorechain-screening.entity';
import { ScorechainScreeningService } from 'src/integration/scorechain/services/scorechain-screening.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BuyCrypto } from '../../../buy-crypto/process/entities/buy-crypto.entity';
import { AmlError } from '../../enums/aml-error.enum';
import { CheckStatus } from '../../enums/check-status.enum';
import { AmlService } from '../aml.service';

// A Scorechain hit never passes on its own — it passes because compliance reviewed the finding with the
// customer. Recording that release on the account is what stops the customer's next deposit from running
// into the identical manual review, so it is pinned here rather than left to the release path.
describe('AmlService — Scorechain review date', () => {
  let service: AmlService;
  let userDataService: UserDataService;
  let specialExternalAccountService: SpecialExternalAccountService;
  let scorechainScreeningService: ScorechainScreeningService;

  const targetAddress = '0xFA73137a652633302DEDC91A79ebdaDb81E0d2C5';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AmlService, TestUtil.provideConfig()],
    })
      .useMocker(() => createMock())
      .compile();

    service = module.get(AmlService);
    userDataService = module.get(UserDataService);
    specialExternalAccountService = module.get(SpecialExternalAccountService);
    scorechainScreeningService = module.get(ScorechainScreeningService);
    jest.spyOn(userDataService, 'updateUserDataInternal').mockImplementation(async (userData) => userData);
  });

  // `user` and `userData` are getters reading through `transaction`, so the fixture has to populate the
  // transaction rather than the entity.
  function passedBuyCrypto(comment?: string, overrides: Partial<BuyCrypto> = {}): BuyCrypto {
    const userData = Object.assign(new UserData(), { id: 42, users: [] });
    const user = Object.assign(new User(), {
      id: 3,
      status: UserStatus.ACTIVE,
      userData,
      address: targetAddress,
    });
    return Object.assign(
      new BuyCrypto(),
      {
        id: 7,
        amlCheck: CheckStatus.PASS,
        comment,
        outputAsset: { name: 'BTC', blockchain: Blockchain.BITCOIN },
        inputReferenceAsset: 'EUR',
        transaction: Object.assign(new Transaction(), { id: 1, userData, user, type: 'BuyCrypto' }),
      },
      overrides,
    );
  }

  // Full evidence-passing linked WITHDRAWAL screening; override fields per negative case.
  function evidenceScreening(overrides: Partial<ScorechainScreening> = {}): ScorechainScreening {
    return Object.assign(new ScorechainScreening(), {
      id: 55,
      context: ScorechainScreeningContext.WITHDRAWAL,
      blockchain: Blockchain.BITCOIN,
      objectId: targetAddress,
      signatureValid: true,
      riskScore: 10,
      ...overrides,
    });
  }

  it('records the review when a Scorechain-flagged transaction is released', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK);

    await service.postProcessing(entity, undefined);

    const [userData, update] = jest.mocked(userDataService.updateUserDataInternal).mock.calls[0];
    expect(userData.id).toBe(42);
    expect(update.scorechainCheckDate).toBeInstanceOf(Date);
  });

  it('records it as well when the Scorechain hit was one of several errors', async () => {
    const entity = passedBuyCrypto(`${AmlError.SCORECHAIN_HIGH_RISK};${AmlError.IP_COUNTRY_MISMATCH}`);

    await service.postProcessing(entity, undefined);

    expect(
      jest
        .mocked(userDataService.updateUserDataInternal)
        .mock.calls.some(([, update]) => update.scorechainCheckDate != null),
    ).toBe(true);
  });

  // The date must not appear for releases that never involved Scorechain, or every passed transaction
  // would silently exempt the account.
  it.each([[AmlError.IP_COUNTRY_MISMATCH], [undefined], ['']])(
    'does not record a review for comment %p',
    async (comment) => {
      const entity = passedBuyCrypto(comment as string);

      await service.postProcessing(entity, undefined);

      expect(
        jest
          .mocked(userDataService.updateUserDataInternal)
          .mock.calls.some(([, update]) => update.scorechainCheckDate != null),
      ).toBe(false);
    },
  );

  it('does not record a review for a transaction that did not pass', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK);
    entity.amlCheck = CheckStatus.PENDING;

    await service.postProcessing(entity, undefined);

    expect(
      jest
        .mocked(userDataService.updateUserDataInternal)
        .mock.calls.some(([, update]) => update.scorechainCheckDate != null),
    ).toBe(false);
  });

  // On a fiat-funded buy the Scorechain hit was on the payout address, so the release must also
  // register exactly that (blockchain, address) — otherwise the next payout to it repeats the
  // identical review. Bound to the screening linked on the tx, with authentic high-risk evidence.
  it('registers the payout address with chain when the linked screening is authentic high-risk evidence', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    // Mixed-case objectId must still match the current target address case-insensitively.
    jest
      .spyOn(scorechainScreeningService, 'getById')
      .mockResolvedValue(evidenceScreening({ objectId: targetAddress.toLowerCase() }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).toHaveBeenCalledWith(
      Blockchain.BITCOIN,
      targetAddress,
      expect.stringContaining('tx 7'),
    );
    const comment = jest.mocked(specialExternalAccountService.registerScorechainExemptAddress).mock.calls[0][2];
    expect(comment).toContain('tx 7');
    expect(comment).toContain('screening 55');
  });

  it('does not register when the tx has no linked screening', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK);

    await service.postProcessing(entity, undefined);

    expect(scorechainScreeningService.getById).not.toHaveBeenCalled();
    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  it('does not register when the linked screening objectId differs from the current target address', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest
      .spyOn(scorechainScreeningService, 'getById')
      .mockResolvedValue(evidenceScreening({ objectId: '0xDIFFERENT000000000000000000000000000001' }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  it('does not register when the linked screening is on another chain', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest
      .spyOn(scorechainScreeningService, 'getById')
      .mockResolvedValue(evidenceScreening({ blockchain: Blockchain.ETHEREUM }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  it('does not register when the linked screening context is MANUAL', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest
      .spyOn(scorechainScreeningService, 'getById')
      .mockResolvedValue(evidenceScreening({ context: ScorechainScreeningContext.MANUAL }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // isHighRisk is fail-closed for the GATE; as EVIDENCE an unverified response must not exempt.
  it('does not register when signatureValid is false', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest.spyOn(scorechainScreeningService, 'getById').mockResolvedValue(evidenceScreening({ signatureValid: false }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // Missing score also fails the GATE closed, but is not authentic high-risk evidence for exemption.
  it('does not register when riskScore is null', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest.spyOn(scorechainScreeningService, 'getById').mockResolvedValue(evidenceScreening({ riskScore: null }));
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(true);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // A deleted screening row leaves nothing to bind the exemption to — no registration, no throw.
  it('does not register when getById returns null (screening deleted)', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest.spyOn(scorechainScreeningService, 'getById').mockResolvedValue(null);

    await expect(service.postProcessing(entity, undefined)).resolves.toBeUndefined();

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // Evidence fields may look complete, but a score above the configured threshold is not high-risk
  // evidence — the exemption must not fire on a non-hit.
  it('does not register when isHighRisk returns false', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest.spyOn(scorechainScreeningService, 'getById').mockResolvedValue(evidenceScreening());
    jest.spyOn(scorechainScreeningService, 'isHighRisk').mockReturnValue(false);

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // A swap's hit was on the incoming deposit tx, not on the payout address — exempting the target
  // address there would suppress a control that never fired for it.
  it('does not register an address for a released swap (crypto-in)', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    Object.assign(entity, { cryptoInput: { id: 5 } });

    await service.postProcessing(entity, undefined);

    expect(scorechainScreeningService.getById).not.toHaveBeenCalled();
    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  it('does not register an address for a release without a Scorechain hit', async () => {
    const entity = passedBuyCrypto(AmlError.IP_COUNTRY_MISMATCH, { scorechainScreeningId: 55 });

    await service.postProcessing(entity, undefined);

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
  });

  // A failed registration only costs one more manual review; an error here must never abort the
  // rest of release post-processing (which would retry endlessly).
  it('does not throw and still completes postProcessing when getById rejects', async () => {
    const entity = passedBuyCrypto(AmlError.SCORECHAIN_HIGH_RISK, { scorechainScreeningId: 55 });
    jest.spyOn(scorechainScreeningService, 'getById').mockRejectedValue(new Error('db down'));

    await expect(service.postProcessing(entity, undefined)).resolves.toBeUndefined();

    expect(specialExternalAccountService.registerScorechainExemptAddress).not.toHaveBeenCalled();
    // scorechainCheckDate side-effect still applied — post-processing was not aborted
    expect(
      jest
        .mocked(userDataService.updateUserDataInternal)
        .mock.calls.some(([, update]) => update.scorechainCheckDate != null),
    ).toBe(true);
  });
});
