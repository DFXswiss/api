import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RealUnitController } from '../controllers/realunit.controller';

// Thin controllers in this codebase delegate straight to the service; these specs assert the W2W transfer
// endpoints wire the JWT/params/body through to the right service call (the service logic itself is covered
// by realunit.service.spec.ts).
describe('RealUnitController (W2W transfer)', () => {
  let controller: RealUnitController;

  const realunitService = {
    prepareTransfer: jest.fn(),
    confirmTransfer: jest.fn(),
  };
  const userService = { getUser: jest.fn() };

  const jwt: JwtPayload = { user: 42, address: '0xUser' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RealUnitController(realunitService as any, {} as any, userService as any, {} as any, {} as any);
  });

  describe('prepareTransfer', () => {
    it('loads the user with kyc/country relations and delegates to the service', async () => {
      const user = { id: 42 };
      const dto = { toAddress: '0xRecipient', amount: 5 } as any;
      userService.getUser.mockResolvedValue(user);
      realunitService.prepareTransfer.mockResolvedValue({ id: 99 });

      const result = await controller.prepareTransfer(jwt, dto);

      expect(userService.getUser).toHaveBeenCalledWith(42, { userData: { kycSteps: true, country: true } });
      expect(realunitService.prepareTransfer).toHaveBeenCalledWith(user, dto);
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('confirmTransfer', () => {
    it('delegates to the service with the parsed numeric id and confirm dto', async () => {
      const dto = { delegation: {}, authorization: {} } as any;
      realunitService.confirmTransfer.mockResolvedValue({ txHash: '0xhash' });

      const result = await controller.confirmTransfer(jwt, '99', dto);

      expect(realunitService.confirmTransfer).toHaveBeenCalledWith(42, 99, dto);
      expect(result).toEqual({ txHash: '0xhash' });
    });
  });
});
