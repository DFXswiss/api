import { createMock } from '@golevelup/ts-jest';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { KycStep } from '../../entities/kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { KycService } from '../kyc.service';

describe('KycService', () => {
  let service: KycService;
  let userDataService: jest.Mocked<UserDataService>;

  beforeEach(() => {
    userDataService = createMock<UserDataService>();

    // only userDataService is touched by getOrCreateStepInternal; avoid wiring all 20 deps
    service = Object.create(KycService.prototype);
    (service as any).userDataService = userDataService;
  });

  function userWithSteps(steps: KycStep[]): UserData {
    const user = createMock<UserData>({ kycHash: 'hash', kycSteps: [] });
    user.hasRole.mockReturnValue(false);
    user.getStepsWith.mockReturnValue(steps);
    return user;
  }

  describe('getOrCreateStepInternal', () => {
    it('recovers from a concurrent create race by returning the step the winner created', async () => {
      const winnerStep = createMock<KycStep>();
      const user = userWithSteps([]); // first pass: no existing step
      const reloaded = userWithSteps([winnerStep]); // after the race: winner's step is present
      userDataService.getByKycHashOrThrow.mockResolvedValue(reloaded);

      jest
        .spyOn(service as any, 'initiateStep')
        .mockRejectedValue(new Error('duplicate key value violates unique constraint "IDX_3a11507..."'));

      const result = await service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0);

      expect(result.step).toBe(winnerStep);
      expect(userDataService.getByKycHashOrThrow).toHaveBeenCalledWith('hash', expect.anything());
    });

    it('rethrows a non-duplicate error without reloading', async () => {
      const user = userWithSteps([]);
      jest.spyOn(service as any, 'initiateStep').mockRejectedValue(new Error('some other failure'));

      await expect(
        service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0),
      ).rejects.toThrow('some other failure');
      expect(userDataService.getByKycHashOrThrow).not.toHaveBeenCalled();
    });

    it('creates and returns a new step when none exists and there is no race', async () => {
      const newStep = createMock<KycStep>();
      const user = userWithSteps([]);
      jest.spyOn(service as any, 'initiateStep').mockResolvedValue(newStep);

      const result = await service.getOrCreateStepInternal(KycStepName.CONTACT_DATA, user, undefined, undefined, 0);

      expect(result.step).toBe(newStep);
      expect(userDataService.getByKycHashOrThrow).not.toHaveBeenCalled();
    });
  });
});
