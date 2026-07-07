import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RealUnitBalancePdfDto } from '../../dto/realunit-pdf.dto';
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
