import { RealUnitController } from '../controllers/realunit.controller';
import {
  RealUnitAktionariatConfirmationStatus,
  RealUnitConfirmAktionariatDto,
  RealUnitConfirmAktionariatQueryDto,
} from '../dto/realunit-confirm-aktionariat.dto';

describe('RealUnitController - confirmAktionariat', () => {
  let controller: RealUnitController;
  const realunitService = { confirmAktionariat: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    // Direct instantiation: the endpoint is public (no guards to resolve) and the controller is a
    // thin delegator, so we skip the Nest DI container and pass the unused deps as empty stubs.
    controller = new RealUnitController(realunitService as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('delegates the validated query to the service and returns its result unchanged', async () => {
    const query: RealUnitConfirmAktionariatQueryDto = {
      email: 'user@example.com',
      code: 'CONFIRM-CODE',
      user: 'aktionariat-user-1',
    };
    const response: RealUnitConfirmAktionariatDto = {
      status: RealUnitAktionariatConfirmationStatus.CONFIRMED,
      confirmedAddresses: ['0xabc'],
      confirmedDate: new Date(),
    };
    realunitService.confirmAktionariat.mockResolvedValue(response);

    await expect(controller.confirmAktionariat(query)).resolves.toBe(response);
    expect(realunitService.confirmAktionariat).toHaveBeenCalledWith(query);
  });
});
