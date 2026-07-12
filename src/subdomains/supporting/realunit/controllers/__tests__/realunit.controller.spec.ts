import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RealUnitBalancePdfDto } from '../../dto/realunit-pdf.dto';
import { RealUnitEmailRegistrationStatus, RealUnitRegistrationStatus } from '../../dto/realunit-registration.dto';
import { RealUnitController } from '../realunit.controller';

// Focused, hermetic coverage of RealUnitController.getBalancePdf (no DB/network). The injected services
// are stubbed; only the real static SwissQRService.toSwissReferenceDate (a pure function) runs, so the
// test genuinely verifies the date normalization the controller performs.
describe('RealUnitController — getBalancePdf', () => {
  const JWT_ADDRESS = '0xAbC0000000000000000000000000000000000001';
  const REALU = { id: 1, name: 'REALU' } as Asset;
  const userData = { completeName: 'Max Mustermann' } as UserData;

  let getUser: jest.Mock;
  let getRealuAsset: jest.Mock;
  let getBalanceData: jest.Mock;
  let createBalanceStatement: jest.Mock;
  let controller: RealUnitController;

  // Populate the global `Config` singleton (normally wired up at app bootstrap) so Config.environment resolves.
  beforeAll(() => {
    new ConfigService();
  });

  beforeEach(() => {
    getUser = jest.fn().mockResolvedValue({ userData });
    getRealuAsset = jest.fn().mockResolvedValue(REALU);
    getBalanceData = jest.fn().mockResolvedValue({
      balances: [{ asset: REALU, balance: 100, price: 1.37, value: 137 }],
      totalValue: 137,
      hasIncompleteData: false,
    });
    createBalanceStatement = jest.fn().mockResolvedValue('pdf');

    controller = new RealUnitController(
      { getRealuAsset } as never, // realunitService
      { getBalanceData } as never, // balancePdfService
      { getUser } as never, // userService
      { createBalanceStatement } as never, // swissQrService
      {} as never, // pricingService (unused here)
    );
  });

  it('rejects a statement request for a wallet the caller does not own — before doing any work', async () => {
    const jwt = { user: 1, address: JWT_ADDRESS } as JwtPayload;
    const dto = {
      address: '0xDDDdddddddddddddddddddddddddddddddddDdddd', // a different wallet
      currency: PriceCurrency.CHF,
      date: new Date('2025-12-31T00:00:00Z'),
    } as RealUnitBalancePdfDto;

    await expect(controller.getBalancePdf(jwt, dto)).rejects.toThrow(ForbiddenException);

    // Fail-closed: no balance is computed and no document is rendered for a foreign wallet.
    expect(getBalanceData).not.toHaveBeenCalled();
    expect(createBalanceStatement).not.toHaveBeenCalled();
  });

  it('values and prints the statement on one consistent Swiss reference date (case-insensitive wallet match)', async () => {
    const jwt = { user: 1, address: JWT_ADDRESS.toLowerCase() } as JwtPayload;
    const dto = {
      address: JWT_ADDRESS.toUpperCase(), // same wallet, different casing → ownership check passes
      currency: PriceCurrency.CHF,
      date: new Date('2025-12-31T00:00:00Z'), // past → future-guard passes
    } as RealUnitBalancePdfDto;

    const result = await controller.getBalancePdf(jwt, dto);
    expect(result).toEqual({ pdfData: 'pdf' });

    const expectedRef = SwissQRService.toSwissReferenceDate(dto.date);
    const dateForValuation = getBalanceData.mock.calls[0][0].date as Date; // dto override passed to getBalanceData
    const dateForDisplay = createBalanceStatement.mock.calls[0][4] as Date; // asOfDate arg (5th) of createBalanceStatement

    // Valuation and display use the very same normalized instance — never two dates that could disagree.
    expect(dateForDisplay).toBe(dateForValuation);
    expect(dateForValuation.getTime()).toBe(expectedRef.getTime());
  });
});

// Delegation coverage for the registration / buy-sell-gate handlers: they load the user with exactly the
// relations they need (the dead kycSteps join was removed) and forward to the service. Pure stubs, no DB.
describe('RealUnitController — registration & gate handler delegation', () => {
  const JWT = { user: 7, address: '0xWalletAddress' } as JwtPayload;
  const user = { id: 7, userData: { id: 70 } };

  let realunitService: {
    getPaymentInfo: jest.Mock;
    getSellPaymentInfo: jest.Mock;
    getRegistrationInfo: jest.Mock;
    hasRegistrationForWallet: jest.Mock;
    forwardRegistrationToAktionariat: jest.Mock;
  };
  let getUser: jest.Mock;
  let controller: RealUnitController;

  beforeEach(() => {
    getUser = jest.fn().mockResolvedValue(user);
    realunitService = {
      getPaymentInfo: jest.fn().mockResolvedValue('buy-info'),
      getSellPaymentInfo: jest.fn().mockResolvedValue('sell-info'),
      getRegistrationInfo: jest.fn().mockResolvedValue('reg-info'),
      hasRegistrationForWallet: jest.fn().mockResolvedValue(true),
      forwardRegistrationToAktionariat: jest.fn().mockResolvedValue(undefined),
    };
    controller = new RealUnitController(
      realunitService as never, // realunitService
      {} as never, // balancePdfService
      { getUser } as never, // userService
      {} as never, // swissQrService
      {} as never, // pricingService
    );
  });

  it('getPaymentInfo loads the user (country relation only) and delegates to the service', async () => {
    const dto = { amount: 100 } as never;

    const res = await controller.getPaymentInfo(JWT, dto);

    expect(res).toBe('buy-info');
    expect(getUser).toHaveBeenCalledWith(7, { userData: { country: true } });
    expect(realunitService.getPaymentInfo).toHaveBeenCalledWith(user, dto);
  });

  it('getSellPaymentInfo loads the user (country relation only) and delegates to the service', async () => {
    const dto = { amount: 1 } as never;

    const res = await controller.getSellPaymentInfo(JWT, dto);

    expect(res).toBe('sell-info');
    expect(getUser).toHaveBeenCalledWith(7, { userData: { country: true } });
    expect(realunitService.getSellPaymentInfo).toHaveBeenCalledWith(user, dto);
  });

  it('getRegistrationInfo loads the display relations (no kycSteps) and delegates userData + address', async () => {
    const res = await controller.getRegistrationInfo(JWT);

    expect(res).toBe('reg-info');
    expect(getUser).toHaveBeenCalledWith(7, {
      userData: { country: true, nationality: true, organizationCountry: true, language: true },
    });
    expect(realunitService.getRegistrationInfo).toHaveBeenCalledWith(user.userData, JWT.address);
  });

  it('getWalletStatus delegates exactly like getRegistrationInfo (deprecated mirror)', async () => {
    const res = await controller.getWalletStatus(JWT);

    expect(res).toBe('reg-info');
    expect(getUser).toHaveBeenCalledWith(7, {
      userData: { country: true, nationality: true, organizationCountry: true, language: true },
    });
    expect(realunitService.getRegistrationInfo).toHaveBeenCalledWith(user.userData, JWT.address);
  });

  it('isRegistered loads only userData and delegates to hasRegistrationForWallet', async () => {
    const res = await controller.isRegistered(JWT);

    expect(res).toBe(true);
    expect(getUser).toHaveBeenCalledWith(7, { userData: true });
    expect(realunitService.hasRegistrationForWallet).toHaveBeenCalledWith(user.userData, JWT.address);
  });

  it('admin forwardRegistration coerces the :id path string to a number', async () => {
    await controller.forwardRegistration('42');

    expect(realunitService.forwardRegistrationToAktionariat).toHaveBeenCalledWith(42);
  });
});

// Coverage for the POST register endpoints: the email step wraps the status, and the complete/wallet steps
// map the service status to 201 CREATED (completed / already-registered) vs 202 ACCEPTED (everything else)
// on the injected Response. Pure stubs, no DB/network.
describe('RealUnitController — register POST endpoints (status mapping)', () => {
  const JWT = { user: 7, account: 70, address: '0xWalletAddress' } as JwtPayload;

  let registerEmail: jest.Mock;
  let completeRegistration: jest.Mock;
  let completeRegistrationForWalletAddress: jest.Mock;
  let controller: RealUnitController;

  const mockRes = (): { status: jest.Mock; json: jest.Mock } => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  };

  beforeEach(() => {
    registerEmail = jest.fn();
    completeRegistration = jest.fn();
    completeRegistrationForWalletAddress = jest.fn();
    controller = new RealUnitController(
      { registerEmail, completeRegistration, completeRegistrationForWalletAddress } as never, // realunitService
      {} as never, // balancePdfService
      {} as never, // userService
      {} as never, // swissQrService
      {} as never, // pricingService
    );
  });

  it('registerEmail delegates to the service and wraps the status', async () => {
    const dto = { email: 'user@example.com' } as never;
    registerEmail.mockResolvedValue(RealUnitEmailRegistrationStatus.EMAIL_REGISTERED);

    const result = await controller.registerEmail(JWT, dto);

    expect(result).toEqual({ status: RealUnitEmailRegistrationStatus.EMAIL_REGISTERED });
    expect(registerEmail).toHaveBeenCalledWith(JWT.account, dto);
  });

  describe('completeRegistration status mapping', () => {
    const dto = { walletAddress: '0xabc' } as never;

    it.each([
      [RealUnitRegistrationStatus.COMPLETED, HttpStatus.CREATED],
      [RealUnitRegistrationStatus.ALREADY_REGISTERED, HttpStatus.CREATED],
      [RealUnitRegistrationStatus.FORWARDING_FAILED, HttpStatus.ACCEPTED],
    ])('maps service status %s to HTTP %i', async (status, code) => {
      completeRegistration.mockResolvedValue(status);
      const res = mockRes();

      await controller.completeRegistration(JWT, dto, res as never);

      expect(completeRegistration).toHaveBeenCalledWith(JWT.account, dto);
      expect(res.status).toHaveBeenCalledWith(code);
      expect(res.json).toHaveBeenCalledWith({ status });
    });
  });

  describe('completeRegistrationForWalletAddress status mapping', () => {
    const dto = { walletAddress: '0xabc', signature: '0xsig', registrationDate: '2026-01-01' } as never;

    it.each([
      [RealUnitRegistrationStatus.COMPLETED, HttpStatus.CREATED],
      [RealUnitRegistrationStatus.ALREADY_REGISTERED, HttpStatus.CREATED],
      [RealUnitRegistrationStatus.FORWARDING_FAILED, HttpStatus.ACCEPTED],
    ])('maps service status %s to HTTP %i', async (status, code) => {
      completeRegistrationForWalletAddress.mockResolvedValue(status);
      const res = mockRes();

      await controller.completeRegistrationForWalletAddress(JWT, dto, res as never);

      expect(completeRegistrationForWalletAddress).toHaveBeenCalledWith(JWT.account, dto);
      expect(res.status).toHaveBeenCalledWith(code);
      expect(res.json).toHaveBeenCalledWith({ status });
    });
  });
});
