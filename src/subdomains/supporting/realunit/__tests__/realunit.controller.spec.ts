import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { PaymentLinkPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import {
  RealUnitOcpPayDto,
  RealUnitOcpPaySubmitDto,
  RealUnitSwapDto,
} from 'src/subdomains/supporting/realunit/dto/realunit-pay.dto';
import { RealUnitSellBroadcastDto } from 'src/subdomains/supporting/realunit/dto/realunit-sell.dto';
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
    it('loads the user with userData and delegates to the service', async () => {
      const user = { id: 42 };
      const dto = { toAddress: '0xRecipient', amount: 5 } as any;
      userService.getUser.mockResolvedValue(user);
      realunitService.prepareTransfer.mockResolvedValue({ id: 99 });

      const result = await controller.prepareTransfer(jwt, dto);

      // Registration is checked via AktionariatRegistrationRepository (async), not kycSteps.
      expect(userService.getUser).toHaveBeenCalledWith(42, { userData: true });
      expect(realunitService.prepareTransfer).toHaveBeenCalledWith(user, dto);
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('confirmTransfer', () => {
    it('delegates to the service with the parsed numeric id and confirm dto', async () => {
      const dto = { delegation: {}, authorization: {} } as any;
      realunitService.confirmTransfer.mockResolvedValue({ txHash: '0xhash' });

      const result = await controller.confirmTransfer(jwt, 99, dto);

      expect(realunitService.confirmTransfer).toHaveBeenCalledWith(42, 99, dto);
      expect(result).toEqual({ txHash: '0xhash' });
    });
  });
});

// Thin controllers in this codebase delegate straight to the service; these specs assert the OCP pay-flow
// endpoints wire the JWT/params/body through to the right service call (the service logic itself is covered
// by realunit.service.spec.ts).
describe('RealUnitController (OCP pay flow)', () => {
  let controller: RealUnitController;

  const realunitService = {
    getSwapPaymentInfo: jest.fn(),
    createSwapUnsignedTransaction: jest.fn(),
    broadcastSwapTransaction: jest.fn(),
    createOcpPayUnsignedTransaction: jest.fn(),
    submitOcpPay: jest.fn(),
    getOcpPayStatus: jest.fn(),
  };
  const userService = { getUser: jest.fn() };

  const jwt = { user: 42, address: '0xUser' } as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RealUnitController(
      realunitService as never, // realunitService
      {} as never, // balancePdfService (unused)
      userService as never, // userService
      {} as never, // swissQrService (unused)
      {} as never, // pricingService (unused)
    );
  });

  describe('getSwapPaymentInfo', () => {
    it('loads the user with kyc/country relations and delegates to the service', async () => {
      const user = { id: 42 };
      const dto = { amount: 10 } as RealUnitSwapDto;
      userService.getUser.mockResolvedValue(user);
      realunitService.getSwapPaymentInfo.mockResolvedValue({ id: 99 });

      const result = await controller.getSwapPaymentInfo(jwt, dto);

      expect(userService.getUser).toHaveBeenCalledWith(42, { userData: { kycSteps: true, country: true } });
      expect(realunitService.getSwapPaymentInfo).toHaveBeenCalledWith(user, dto);
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('getSwapUnsignedTransaction', () => {
    it('delegates to the service with the parsed numeric id', async () => {
      realunitService.createSwapUnsignedTransaction.mockResolvedValue({ swap: '0xabc' });

      const result = await controller.getSwapUnsignedTransaction(jwt, 7);

      expect(realunitService.createSwapUnsignedTransaction).toHaveBeenCalledWith(42, 7);
      expect(result).toEqual({ swap: '0xabc' });
    });
  });

  describe('broadcastSwapTransaction', () => {
    it('delegates to the service with the parsed id and broadcast dto', async () => {
      const dto = { unsignedTx: '0x', r: '0x', s: '0x', v: 27 } as RealUnitSellBroadcastDto;
      realunitService.broadcastSwapTransaction.mockResolvedValue({ txHash: '0xhash' });

      const result = await controller.broadcastSwapTransaction(jwt, 7, dto);

      expect(realunitService.broadcastSwapTransaction).toHaveBeenCalledWith(42, 7, dto);
      expect(result).toEqual({ txHash: '0xhash' });
    });
  });

  describe('getOcpPayUnsignedTransaction', () => {
    it('delegates to the service with the jwt address, payment-link id and quote id', async () => {
      const dto = { paymentLinkId: 'pl_abc', quoteId: 'quote_xyz' } as RealUnitOcpPayDto;
      realunitService.createOcpPayUnsignedTransaction.mockResolvedValue({ unsignedTx: '0x' });

      const result = await controller.getOcpPayUnsignedTransaction(jwt, dto);

      expect(realunitService.createOcpPayUnsignedTransaction).toHaveBeenCalledWith('0xUser', 'pl_abc', 'quote_xyz');
      expect(result).toEqual({ unsignedTx: '0x' });
    });
  });

  describe('submitOcpPay', () => {
    it('delegates to the service with the submit dto', async () => {
      const dto = {
        paymentLinkId: 'pl_abc',
        quoteId: 'quote_xyz',
        unsignedTx: '0x',
        r: '0x',
        s: '0x',
        v: 27,
      } as RealUnitOcpPaySubmitDto;
      realunitService.submitOcpPay.mockResolvedValue({ txId: '0xTxId' });

      const result = await controller.submitOcpPay(dto);

      expect(realunitService.submitOcpPay).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ txId: '0xTxId' });
    });
  });

  describe('getOcpPayStatus', () => {
    it('delegates to the service with the payment-link id', async () => {
      realunitService.getOcpPayStatus.mockResolvedValue({ status: PaymentLinkPaymentStatus.COMPLETED });

      const result = await controller.getOcpPayStatus('pl_abc');

      expect(realunitService.getOcpPayStatus).toHaveBeenCalledWith('pl_abc');
      expect(result).toEqual({ status: PaymentLinkPaymentStatus.COMPLETED });
    });
  });
});
