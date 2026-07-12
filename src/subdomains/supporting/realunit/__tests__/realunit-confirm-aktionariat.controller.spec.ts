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

  it('delegates the validated query plus the raw request (url + full query) to the service and returns its result unchanged', async () => {
    const query: RealUnitConfirmAktionariatQueryDto = {
      email: 'user@example.com',
      code: 'CONFIRM-CODE',
      user: 'aktionariat-user-1',
    };
    // The Express request carries the untouched incoming query and the full URL.
    const req = {
      originalUrl: '/v1/realunit/confirm-aktionariat?email=user@example.com&code=CONFIRM-CODE&user=aktionariat-user-1',
      query: { email: 'user@example.com', code: 'CONFIRM-CODE', user: 'aktionariat-user-1' },
    };
    const response: RealUnitConfirmAktionariatDto = {
      status: RealUnitAktionariatConfirmationStatus.CONFIRMED,
      confirmedAddresses: ['0xabc'],
      confirmedDate: new Date(),
    };
    realunitService.confirmAktionariat.mockResolvedValue(response);

    await expect(controller.confirmAktionariat(query, req as any)).resolves.toBe(response);
    expect(realunitService.confirmAktionariat).toHaveBeenCalledWith(query, {
      url: req.originalUrl,
      query: req.query,
    });
  });

  it('forwards extra unknown mail-link params (stripped from the typed DTO) to the service via the raw query', async () => {
    const query: RealUnitConfirmAktionariatQueryDto = {
      email: 'user@example.com',
      code: 'CONFIRM-CODE',
      user: 'aktionariat-user-1',
    };
    // The raw request still carries params the DTO does not model (whitelist: true strips them from `query`).
    const req = {
      originalUrl:
        '/v1/realunit/confirm-aktionariat?email=user@example.com&code=CONFIRM-CODE&user=aktionariat-user-1&address=0xABC&foo=bar',
      query: {
        email: 'user@example.com',
        code: 'CONFIRM-CODE',
        user: 'aktionariat-user-1',
        address: '0xABC',
        foo: 'bar',
      },
    };
    realunitService.confirmAktionariat.mockResolvedValue({
      status: RealUnitAktionariatConfirmationStatus.CONFIRMED,
      confirmedAddresses: [],
    });

    await controller.confirmAktionariat(query, req as any);

    expect(realunitService.confirmAktionariat).toHaveBeenCalledWith(query, {
      url: req.originalUrl,
      query: expect.objectContaining({ address: '0xABC', foo: 'bar' }),
    });
  });
});
