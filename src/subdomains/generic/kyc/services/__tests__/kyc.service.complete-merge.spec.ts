import { ConfigService } from 'src/config/config';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { KycLevel, KycStatus } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { requiredKycSteps } from '../../enums/kyc.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycService } from '../kyc.service';
import { NameCheckService } from '../name-check.service';

jest.mock('../../enums/kyc.enum', () => ({
  ...jest.requireActual('../../enums/kyc.enum'),
  requiredKycSteps: jest.fn(),
}));

describe('KycService.completeKycAfterMerge', () => {
  let service: KycService;
  let nameCheckService: jest.Mocked<Partial<NameCheckService>>;
  let userDataService: jest.Mocked<Partial<UserDataService>>;

  const required = [KycStepName.CONTACT_DATA, KycStepName.IDENT, KycStepName.DFX_APPROVAL];

  const completedStep = (name: KycStepName): KycStep =>
    Object.assign(new KycStep(), { name, status: ReviewStatus.COMPLETED });

  const buildUser = (kycLevel: KycLevel, completed: KycStepName[]): UserData =>
    Object.assign(new UserData(), { kycLevel, kycSteps: completed.map(completedStep) });

  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    (requiredKycSteps as jest.Mock).mockReturnValue(required);
    nameCheckService = { hasOpenNameChecks: jest.fn().mockResolvedValue(false) };
    userDataService = { updateUserDataInternal: jest.fn() };

    service = Object.create(KycService.prototype) as KycService;
    (service as unknown as { nameCheckService: NameCheckService }).nameCheckService =
      nameCheckService as unknown as NameCheckService;
    (service as unknown as { userDataService: UserDataService }).userDataService =
      userDataService as unknown as UserDataService;
  });

  it('reconciles to LEVEL_50 when all required steps are completed and no name check is open', async () => {
    await service.completeKycAfterMerge(buildUser(KycLevel.LEVEL_20, required));

    expect(userDataService.updateUserDataInternal).toHaveBeenCalledWith(expect.any(UserData), {
      kycLevel: KycLevel.LEVEL_50,
      kycStatus: KycStatus.COMPLETED,
    });
  });

  it('does nothing when a required step (e.g. DFX_APPROVAL) is not yet completed', async () => {
    await service.completeKycAfterMerge(buildUser(KycLevel.LEVEL_20, [KycStepName.CONTACT_DATA, KycStepName.IDENT]));

    expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
  });

  it('does nothing when a name check is still open', async () => {
    nameCheckService.hasOpenNameChecks.mockResolvedValue(true);

    await service.completeKycAfterMerge(buildUser(KycLevel.LEVEL_20, required));

    expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
  });

  it('does nothing when the user is already at LEVEL_50', async () => {
    await service.completeKycAfterMerge(buildUser(KycLevel.LEVEL_50, required));

    expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    expect(nameCheckService.hasOpenNameChecks).not.toHaveBeenCalled();
  });
});
