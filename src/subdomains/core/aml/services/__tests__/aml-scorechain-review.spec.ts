import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AmlService, TestUtil.provideConfig()],
    })
      .useMocker(() => createMock())
      .compile();

    service = module.get(AmlService);
    userDataService = module.get(UserDataService);
    jest.spyOn(userDataService, 'updateUserDataInternal').mockImplementation(async (userData) => userData);
  });

  // `user` and `userData` are getters reading through `transaction`, so the fixture has to populate the
  // transaction rather than the entity.
  function passedBuyCrypto(comment?: string): BuyCrypto {
    const userData = Object.assign(new UserData(), { id: 42, users: [] });
    const user = Object.assign(new User(), { id: 3, status: UserStatus.ACTIVE, userData });
    return Object.assign(new BuyCrypto(), {
      id: 7,
      amlCheck: CheckStatus.PASS,
      comment,
      outputAsset: { name: 'BTC' },
      inputReferenceAsset: 'EUR',
      transaction: Object.assign(new Transaction(), { id: 1, userData, user, type: 'BuyCrypto' }),
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
});
