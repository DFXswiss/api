import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Config, ConfigService } from 'src/config/config';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { BalanceEntry, PdfUtil } from 'src/shared/utils/pdf.util';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { CoinGeckoService } from 'src/subdomains/supporting/pricing/services/integration/coin-gecko.service';
import { PriceCurrency } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { GetCustodyPdfDto } from '../../dto/input/get-custody-pdf.dto';
import { CustodyBalance } from '../../entities/custody-balance.entity';
import { CustodyBalanceRepository } from '../../repositories/custody-balance.repository';
import { CustodyPdfService } from '../custody-pdf.service';
import { CustodyService } from '../custody.service';

describe('CustodyPdfService', () => {
  let service: CustodyPdfService;
  let userDataService: DeepMocked<UserDataService>;
  let custodyBalanceRepo: DeepMocked<CustodyBalanceRepository>;
  let assetPricesService: DeepMocked<AssetPricesService>;
  let coinGeckoService: DeepMocked<CoinGeckoService>;
  let i18n: DeepMocked<I18nService>;
  let custodyService: DeepMocked<CustodyService>;

  const accountId = 100;
  const statementDate = new Date('2026-01-15T00:00:00.000Z');

  // Populates the global `Config` singleton before it is read below (module load time, ahead of
  // any hook), the same requirement covered by BalancePdfService's spec.
  new ConfigService();

  const savingAsset = createCustomAsset({ id: 60, name: 'sZCHF', uniqueName: Config.custody.savingAsset });
  const otherAsset = createCustomAsset({ id: 61, name: 'BTC', uniqueName: 'Bitcoin/BTC' });

  beforeEach(() => {
    userDataService = createMock<UserDataService>();
    custodyBalanceRepo = createMock<CustodyBalanceRepository>();
    assetPricesService = createMock<AssetPricesService>();
    coinGeckoService = createMock<CoinGeckoService>();
    i18n = createMock<I18nService>();
    custodyService = createMock<CustodyService>();

    i18n.translate.mockImplementation((key: string) => key as any);

    service = new CustodyPdfService(
      userDataService,
      custodyBalanceRepo,
      assetPricesService,
      coinGeckoService,
      i18n,
      custodyService,
    );

    // Mocked so createPdf never has to render real table/footer content or the logo — this suite
    // asserts on the priced BalanceEntry[] and totalValue handed to them, not on PDF bytes.
    jest.spyOn(PdfUtil, 'drawLogo').mockImplementation(() => undefined);
    jest.spyOn(PdfUtil, 'drawTable').mockImplementation(() => undefined);
    jest.spyOn(PdfUtil, 'drawFooter').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function custodyUsers(...ids: number[]) {
    return ids.map((id) => createCustomUser({ id, role: UserRole.CUSTODY }));
  }

  function balanceRow(
    asset: ReturnType<typeof createCustomAsset>,
    balance: number,
    user: ReturnType<typeof createCustomUser>,
  ) {
    return Object.assign(new CustodyBalance(), { asset, balance, user });
  }

  function historicalPrice(priceChf: number, priceEur: number, priceUsd: number): AssetPrice {
    return Object.assign(new AssetPrice(), { priceChf, priceEur, priceUsd });
  }

  function pdfDto(overrides: Partial<GetCustodyPdfDto> = {}): GetCustodyPdfDto {
    return Object.assign(new GetCustodyPdfDto(), {
      currency: PriceCurrency.CHF,
      date: statementDate,
      ...overrides,
    });
  }

  function drawnBalances(): BalanceEntry[] {
    const call = (PdfUtil.drawTable as jest.Mock).mock.calls[0];
    return call[1];
  }

  it('folds accrued interest into the saving position balance, priced with the historical price for the statement date', async () => {
    const users = custodyUsers(7);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([balanceRow(savingAsset, 99500, users[0])]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(2, 1.9, 2.1));
    custodyService.calculateAccruedInterest.mockResolvedValue(1805);

    await service.generateCustodyPdf(accountId, pdfDto());

    const balances = drawnBalances();
    const szchf = balances.find((b) => b.asset.uniqueName === Config.custody.savingAsset);

    expect(szchf.balance).toBe(101305);
    expect(szchf.value).toBe(101305 * 2);
  });

  it('calls calculateAccruedInterest with exactly the custody user ids, the saving asset, and the statement date (not new Date())', async () => {
    const users = custodyUsers(7, 8);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([
      balanceRow(savingAsset, 50000, users[0]),
      balanceRow(savingAsset, 49500, users[1]),
    ]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));
    custodyService.calculateAccruedInterest.mockResolvedValue(0);

    const dto = pdfDto();
    await service.generateCustodyPdf(accountId, dto);

    expect(custodyService.calculateAccruedInterest).toHaveBeenCalledWith(
      [7, 8],
      expect.objectContaining({ uniqueName: Config.custody.savingAsset }),
      dto.date,
    );
    // Must be the statement date passed through the DTO, not the current time.
    expect(custodyService.calculateAccruedInterest.mock.calls[0][2]).not.toBe(undefined);
    expect(custodyService.calculateAccruedInterest.mock.calls[0][2].getTime()).toBe(statementDate.getTime());
  });

  it('sums multiple custody users balances of the saving asset before folding in interest', async () => {
    const users = custodyUsers(7, 8);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([
      balanceRow(savingAsset, 50000, users[0]),
      balanceRow(savingAsset, 49500, users[1]),
    ]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));
    custodyService.calculateAccruedInterest.mockResolvedValue(1805);

    await service.generateCustodyPdf(accountId, pdfDto());

    const balances = drawnBalances();
    const szchf = balances.find((b) => b.asset.uniqueName === Config.custody.savingAsset);

    // 50000 + 49500 summed first, then interest folded in once on the summed total.
    expect(szchf.balance).toBe(99500 + 1805);
    expect(custodyService.calculateAccruedInterest).toHaveBeenCalledTimes(1);
  });

  it('leaves non-saving assets untouched and calls calculateAccruedInterest exactly once overall', async () => {
    const users = custodyUsers(7);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([
      balanceRow(savingAsset, 99500, users[0]),
      balanceRow(otherAsset, 0.5, users[0]),
    ]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));
    custodyService.calculateAccruedInterest.mockResolvedValue(1805);

    await service.generateCustodyPdf(accountId, pdfDto());

    const balances = drawnBalances();
    const btc = balances.find((b) => b.asset.uniqueName === 'Bitcoin/BTC');

    expect(btc.balance).toBe(0.5);
    expect(custodyService.calculateAccruedInterest).toHaveBeenCalledTimes(1);
  });

  it('does not call calculateAccruedInterest when the saving balance is at or below the dust threshold', async () => {
    const users = custodyUsers(7);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([
      balanceRow(savingAsset, 1e-9, users[0]),
      balanceRow(otherAsset, 0.5, users[0]),
    ]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));

    await service.generateCustodyPdf(accountId, pdfDto());

    expect(custodyService.calculateAccruedInterest).not.toHaveBeenCalled();
  });

  it('does not call calculateAccruedInterest when there is no saving position at all', async () => {
    const users = custodyUsers(7);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([balanceRow(otherAsset, 0.5, users[0])]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));

    await service.generateCustodyPdf(accountId, pdfDto());

    expect(custodyService.calculateAccruedInterest).not.toHaveBeenCalled();
  });

  it('propagates the error when calculateAccruedInterest rejects, instead of silently omitting interest', async () => {
    const users = custodyUsers(7);
    userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: accountId, users }));
    custodyBalanceRepo.findBy.mockResolvedValue([balanceRow(savingAsset, 99500, users[0])]);
    assetPricesService.getAssetPriceForDate.mockResolvedValue(historicalPrice(1, 1, 1));
    custodyService.calculateAccruedInterest.mockRejectedValue(
      new Error('CustodyOrder 1 is Completed but has no completedAt — cannot calculate interest'),
    );

    await expect(service.generateCustodyPdf(accountId, pdfDto())).rejects.toThrow(/cannot calculate interest/);
  });

  it('throws NotFoundException when the account is missing', async () => {
    userDataService.getUserData.mockResolvedValue(null);

    await expect(service.generateCustodyPdf(accountId, pdfDto())).rejects.toThrow(NotFoundException);
  });
});
