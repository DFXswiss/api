import { NotFoundException } from '@nestjs/common';
import { request } from 'graphql-request';
import { BrokerbotCurrency } from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { HistoryEventType } from '../dto/client.dto';
import { RealUnitDtoMapper } from '../dto/realunit-dto.mapper';
import { TimeFrame } from '../dto/realunit.dto';
import { RealUnitService } from '../realunit.service';
import { TimeseriesUtils } from '../utils/timeseries-utils';

jest.mock('graphql-request', () => ({
  ...jest.requireActual('graphql-request'),
  request: jest.fn(),
}));

const mockedRequest = request as jest.MockedFunction<typeof request>;

// The market-data half of RealUnitService talks to the Ponder indexer, the pricing services and the
// brokerbot. Its own dependencies are what makes it interesting, so the service is built with
// Object.create and only the collaborators each method actually touches — the constructor takes 30+
// injections and wiring all of them would say nothing about the logic under test. Same approach as
// kyc.service.spec.ts.
describe('RealUnitService market data', () => {
  let service: RealUnitService;
  let assetService: { getAssetByQuery: jest.Mock };
  let pricingService: { getPrice: jest.Mock };
  let assetPricesService: { getAssetPrices: jest.Mock };
  let blockchainService: { getBrokerbotPrice: jest.Mock; getBrokerbotInfo: jest.Mock };
  let fiatService: { getFiatByName: jest.Mock };
  let feeService: { getUserFee: jest.Mock };

  const realuAsset = { id: 1, name: 'REALU', chainId: '0xREALU' } as unknown as Asset;
  const zchfAsset = { id: 2, name: 'ZCHF', chainId: '0xZCHF' } as unknown as Asset;

  // dfx 1%, bank 0.5%, partner 0.5% => 2% rate; 1 + 1 + 1 fixed; 3 network. Round numbers keep the
  // fee arithmetic below checkable by hand.
  const fee = {
    dfx: { rate: 0.01, fixed: 1 },
    bank: { rate: 0.005, fixed: 1 },
    partner: { rate: 0.005, fixed: 1 },
    network: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    assetService = { getAssetByQuery: jest.fn() };
    pricingService = { getPrice: jest.fn() };
    assetPricesService = { getAssetPrices: jest.fn() };
    blockchainService = { getBrokerbotPrice: jest.fn(), getBrokerbotInfo: jest.fn() };
    fiatService = { getFiatByName: jest.fn() };
    feeService = { getUserFee: jest.fn() };

    service = Object.create(RealUnitService.prototype);
    Object.assign(service, {
      assetService,
      pricingService,
      assetPricesService,
      blockchainService,
      fiatService,
      feeService,
      ponderUrl: 'https://ponder.test/graphql',
      tokenName: 'REALU',
      genesisDate: new Date('2022-04-12T07:46:41.000Z'),
      // Pass-through cache: the caching itself belongs to AsyncCache, not to this service.
      historicalPriceCache: { get: jest.fn(async (_key: unknown, fn: () => Promise<unknown>) => fn()) },
    });

    // tokenBlockchain is a getter on the prototype (it reads the environment-dependent chain), so it
    // is shadowed with a fixed value rather than assigned.
    Object.defineProperty(service, 'tokenBlockchain', { value: Blockchain.ETHEREUM, configurable: true });

    // REALU first, ZCHF second — getBrokerbotInfo resolves both.
    assetService.getAssetByQuery.mockImplementation(async ({ name }: { name: string }) =>
      name === 'ZCHF' ? zchfAsset : realuAsset,
    );
  });

  describe('getAccount', () => {
    it('maps the indexer response together with the full price history', async () => {
      const clientResponse = { account: { id: '0xabc' } };
      const prices = [{ timestamp: 1, chf: 1, eur: 1, usd: 1 }];
      mockedRequest.mockResolvedValue(clientResponse as never);
      jest.spyOn(service, 'getHistoricalPrice').mockResolvedValue(prices as never);
      const mapped = { balance: '1' };
      jest.spyOn(RealUnitDtoMapper, 'toAccountSummaryDto').mockReturnValue(mapped as never);

      await expect(service.getAccount('0xABC')).resolves.toBe(mapped);

      // The indexer keys accounts by lowercase address.
      expect(mockedRequest).toHaveBeenCalledWith(expect.any(String), expect.anything(), { id: '0xabc' });
      expect(service.getHistoricalPrice).toHaveBeenCalledWith(TimeFrame.ALL);
      expect(RealUnitDtoMapper.toAccountSummaryDto).toHaveBeenCalledWith(clientResponse, prices);
    });

    it('throws when the indexer knows no such account', async () => {
      mockedRequest.mockResolvedValue({ account: null } as never);

      await expect(service.getAccount('0xabc')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHolders', () => {
    it('defaults the page size to 50 and passes the cursors through as null', async () => {
      mockedRequest.mockResolvedValue({} as never);
      jest.spyOn(RealUnitDtoMapper, 'toHoldersDto').mockReturnValue({ holders: [] } as never);

      await service.getHolders();

      expect(mockedRequest).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
        limit: 50,
        before: null,
        after: null,
      });
    });

    it('forwards an explicit page size and cursors', async () => {
      mockedRequest.mockResolvedValue({} as never);
      jest.spyOn(RealUnitDtoMapper, 'toHoldersDto').mockReturnValue({ holders: [] } as never);

      await service.getHolders(10, 'BEFORE', 'AFTER');

      expect(mockedRequest).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
        limit: 10,
        before: 'BEFORE',
        after: 'AFTER',
      });
    });
  });

  describe('getAccountHistory', () => {
    it('lowercases the address and defaults the page size', async () => {
      mockedRequest.mockResolvedValue({ account: { id: '0xabc' } } as never);
      const mapped = { history: [] };
      jest.spyOn(RealUnitDtoMapper, 'toAccountHistoryDto').mockReturnValue(mapped as never);

      await expect(service.getAccountHistory('0xABC')).resolves.toBe(mapped);

      expect(mockedRequest).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
        id: '0xabc',
        limit: 50,
        before: null,
        after: null,
      });
    });

    it('forwards an explicit page size and cursors', async () => {
      mockedRequest.mockResolvedValue({ account: {} } as never);
      jest.spyOn(RealUnitDtoMapper, 'toAccountHistoryDto').mockReturnValue({ history: [] } as never);

      await service.getAccountHistory('0xabc', 25, 'BEFORE', 'AFTER');

      expect(mockedRequest).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
        id: '0xabc',
        limit: 25,
        before: 'BEFORE',
        after: 'AFTER',
      });
    });

    it('throws when the account is unknown', async () => {
      mockedRequest.mockResolvedValue({ account: null } as never);

      await expect(service.getAccountHistory('0xabc')).rejects.toThrow(NotFoundException);
    });
  });

  // Both lookups below page through the account history until they find what they need. The paging
  // is the point: a transfer can sit on any page, and the loop must stop at the last one rather
  // than spin.
  describe('getHistoryEventByTxHash', () => {
    const page = (history: unknown[], hasNextPage = false, endCursor = 'NEXT') => ({
      history,
      pageInfo: { hasNextPage, endCursor },
    });

    const transfer = (txHash: string) => ({ txHash, eventType: HistoryEventType.TRANSFER });

    it('returns the matching transfer from the first page, matching case-insensitively', async () => {
      const event = transfer('0xDEF');
      jest.spyOn(service, 'getAccountHistory').mockResolvedValue(page([event]) as never);

      await expect(service.getHistoryEventByTxHash('0xabc', '0xdef')).resolves.toBe(event);
    });

    it('follows the cursor until the transfer is found', async () => {
      const event = transfer('0xdef');
      jest
        .spyOn(service, 'getAccountHistory')
        .mockResolvedValueOnce(page([transfer('0xother')], true, 'CURSOR') as never)
        .mockResolvedValueOnce(page([event]) as never);

      await expect(service.getHistoryEventByTxHash('0xabc', '0xdef')).resolves.toBe(event);
      expect(service.getAccountHistory).toHaveBeenNthCalledWith(2, '0xabc', 100, undefined, 'CURSOR');
    });

    it('ignores an event with the right hash but the wrong type', async () => {
      jest
        .spyOn(service, 'getAccountHistory')
        .mockResolvedValue(page([{ txHash: '0xdef', eventType: HistoryEventType.APPROVAL }]) as never);

      await expect(service.getHistoryEventByTxHash('0xabc', '0xdef')).rejects.toThrow(NotFoundException);
    });

    it('throws once the last page is exhausted', async () => {
      jest.spyOn(service, 'getAccountHistory').mockResolvedValue(page([]) as never);

      await expect(service.getHistoryEventByTxHash('0xabc', '0xdef')).rejects.toThrow(
        'Transaction not found in account history',
      );
    });
  });

  describe('getHistoryEventsByTxHashes', () => {
    const page = (history: unknown[], hasNextPage = false, endCursor = 'NEXT') => ({
      history,
      pageInfo: { hasNextPage, endCursor },
    });

    const transfer = (txHash: string) => ({ txHash, eventType: HistoryEventType.TRANSFER });

    it('collects every requested transfer and stops as soon as all are found', async () => {
      const a = transfer('0xAAA');
      const b = transfer('0xbbb');
      const spy = jest.spyOn(service, 'getAccountHistory').mockResolvedValue(page([a, b], true) as never);

      await expect(service.getHistoryEventsByTxHashes('0xabc', ['0xaaa', '0xBBB'])).resolves.toEqual([a, b]);
      // Both found on the first page, so the loop condition ends it without a second request.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not add the same transaction twice', async () => {
      const a = transfer('0xaaa');
      jest.spyOn(service, 'getAccountHistory').mockResolvedValue(page([a, { ...a }]) as never);

      await expect(service.getHistoryEventsByTxHashes('0xabc', ['0xaaa', '0xmissing'])).resolves.toEqual([a]);
    });

    it('skips events of the wrong type and returns what it found when the pages run out', async () => {
      jest
        .spyOn(service, 'getAccountHistory')
        .mockResolvedValue(page([{ txHash: '0xaaa', eventType: HistoryEventType.APPROVAL }]) as never);

      await expect(service.getHistoryEventsByTxHashes('0xabc', ['0xaaa'])).resolves.toEqual([]);
    });

    it('follows the cursor across pages', async () => {
      const b = transfer('0xbbb');
      jest
        .spyOn(service, 'getAccountHistory')
        .mockResolvedValueOnce(page([transfer('0xaaa')], true, 'CURSOR') as never)
        .mockResolvedValueOnce(page([b]) as never);

      await expect(service.getHistoryEventsByTxHashes('0xabc', ['0xaaa', '0xbbb'])).resolves.toHaveLength(2);
      expect(service.getAccountHistory).toHaveBeenNthCalledWith(2, '0xabc', 100, undefined, 'CURSOR');
    });
  });

  describe('getRealUnitPrice', () => {
    it('resolves all three currencies and hands them to the mapper', async () => {
      pricingService.getPrice.mockResolvedValueOnce('CHF').mockResolvedValueOnce('EUR').mockResolvedValueOnce('USD');
      const mapped = { timestamp: 1, chf: 1, eur: 1, usd: 1 };
      jest.spyOn(RealUnitDtoMapper, 'priceToHistoricalPriceDto').mockReturnValue(mapped as never);

      await expect(service.getRealUnitPrice()).resolves.toBe(mapped);

      expect(RealUnitDtoMapper.priceToHistoricalPriceDto).toHaveBeenCalledWith('CHF', 'EUR', 'USD');
    });

    // A missing rate for one currency must not fail the whole price lookup — the mapper decides
    // what a null means for the response.
    it('degrades a failing currency to null instead of rejecting', async () => {
      pricingService.getPrice
        .mockRejectedValueOnce(new Error('no CHF rate'))
        .mockResolvedValueOnce('EUR')
        .mockRejectedValueOnce(new Error('no USD rate'));
      jest.spyOn(RealUnitDtoMapper, 'priceToHistoricalPriceDto').mockReturnValue({} as never);

      await service.getRealUnitPrice();

      expect(RealUnitDtoMapper.priceToHistoricalPriceDto).toHaveBeenCalledWith(null, 'EUR', null);
    });
  });

  describe('getHistoricalPrice', () => {
    beforeEach(() => {
      assetPricesService.getAssetPrices.mockResolvedValue([]);
      jest.spyOn(TimeseriesUtils, 'fillMissingDates').mockImplementation((p) => p as never);
      jest.spyOn(RealUnitDtoMapper, 'assetPricesToHistoricalPricesDto').mockReturnValue([] as never);
    });

    it.each([
      [TimeFrame.MONTH, 30],
      [TimeFrame.QUARTER, 90],
      [TimeFrame.YEAR, 365],
      ['Week' as TimeFrame, 7],
    ])('starts the %s series %i days back', async (timeFrame, days) => {
      const before = Util.daysBefore(days);

      await service.getHistoricalPrice(timeFrame);

      const [, startDate] = assetPricesService.getAssetPrices.mock.calls[0];
      // Same day rather than same millisecond: both dates are computed moments apart.
      expect(Math.abs(startDate.getTime() - before.getTime())).toBeLessThan(60_000);
    });

    it('starts the ALL series at the token genesis', async () => {
      await service.getHistoricalPrice(TimeFrame.ALL);

      const [, startDate] = assetPricesService.getAssetPrices.mock.calls[0];
      expect(startDate).toEqual(new Date('2022-04-12T07:46:41.000Z'));
    });

    // The cached series ends at the last indexed close; the live price is more recent, so the last
    // point is overwritten rather than appended.
    it('replaces the last point with the current live price', async () => {
      jest.spyOn(RealUnitDtoMapper, 'assetPricesToHistoricalPricesDto').mockReturnValue([
        { timestamp: 1, chf: 1, eur: 1, usd: 1 },
        { timestamp: 2, chf: 2, eur: 2, usd: 2 },
      ] as never);
      const live = { timestamp: 99, chf: 9, eur: 8, usd: 7 };
      jest.spyOn(service, 'getRealUnitPrice').mockResolvedValue(live as never);

      const result = await service.getHistoricalPrice(TimeFrame.MONTH);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ timestamp: 1, chf: 1, eur: 1, usd: 1 });
      expect(result[1]).toEqual(live);
    });

    it('does not look up the live price for an empty series', async () => {
      const spy = jest.spyOn(service, 'getRealUnitPrice');

      await expect(service.getHistoricalPrice(TimeFrame.MONTH)).resolves.toEqual([]);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getRealUnitInfo', () => {
    it('maps the token info response', async () => {
      mockedRequest.mockResolvedValue({ token: {} } as never);
      const mapped = { totalSupply: '1' };
      jest.spyOn(RealUnitDtoMapper, 'toTokenInfoDto').mockReturnValue(mapped as never);

      await expect(service.getRealUnitInfo()).resolves.toBe(mapped);
    });
  });

  describe('brokerbot pass-throughs', () => {
    it('forwards price, buy price and buy shares to the blockchain service', async () => {
      const blockchain = service as unknown as { blockchainService: Record<string, jest.Mock> };
      blockchain.blockchainService.getBrokerbotPrice.mockResolvedValue('PRICE');
      blockchain.blockchainService.getBrokerbotBuyPrice = jest.fn().mockResolvedValue('BUY_PRICE');
      blockchain.blockchainService.getBrokerbotBuyShares = jest.fn().mockResolvedValue('BUY_SHARES');

      await expect(service.getBrokerbotPrice(BrokerbotCurrency.CHF)).resolves.toBe('PRICE');
      await expect(service.getBrokerbotBuyPrice(5, BrokerbotCurrency.CHF)).resolves.toBe('BUY_PRICE');
      await expect(service.getBrokerbotBuyShares(100, BrokerbotCurrency.CHF)).resolves.toBe('BUY_SHARES');
    });

    it('getBrokerbotInfo resolves both assets and passes their chain ids', async () => {
      blockchainService.getBrokerbotInfo.mockResolvedValue('INFO');

      await expect(service.getBrokerbotInfo(BrokerbotCurrency.CHF)).resolves.toBe('INFO');

      expect(blockchainService.getBrokerbotInfo).toHaveBeenCalledWith(
        expect.any(String),
        '0xREALU',
        '0xZCHF',
        BrokerbotCurrency.CHF,
      );
    });
  });

  describe('getBrokerbotSellPrice', () => {
    beforeEach(() => {
      fiatService.getFiatByName.mockResolvedValue({ name: 'CHF' });
      feeService.getUserFee.mockResolvedValue(fee);
    });

    // gross 1000; fee 1000*0.02 + 3 fixed + 3 network = 26; net 974 over 10 shares = 97.4
    it('subtracts the full fee from the gross proceeds', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await expect(service.getBrokerbotSellPrice({} as never, 10)).resolves.toEqual({
        shares: 10,
        pricePerShare: 97.4,
        estimatedAmount: 974,
        currency: BrokerbotCurrency.CHF,
      });
    });

    it('defaults the currency to CHF and honours an explicit one', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await service.getBrokerbotSellPrice({} as never, 10);
      expect(blockchainService.getBrokerbotPrice).toHaveBeenCalledWith(BrokerbotCurrency.CHF);

      await service.getBrokerbotSellPrice({} as never, 10, BrokerbotCurrency.EUR);
      expect(blockchainService.getBrokerbotPrice).toHaveBeenLastCalledWith(BrokerbotCurrency.EUR);
    });

    // Fees exceeding the gross proceeds must not produce a negative payout.
    it('floors the estimated amount at zero', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 1 });

      await expect(service.getBrokerbotSellPrice({} as never, 1)).resolves.toMatchObject({
        estimatedAmount: 0,
        pricePerShare: 0,
      });
    });

    it('reports a zero price per share for a zero-share request rather than dividing by zero', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await expect(service.getBrokerbotSellPrice({} as never, 0)).resolves.toMatchObject({
        shares: 0,
        pricePerShare: 0,
      });
    });
  });

  describe('getBrokerbotSellShares', () => {
    beforeEach(() => {
      fiatService.getFiatByName.mockResolvedValue({ name: 'CHF' });
      feeService.getUserFee.mockResolvedValue(fee);
    });

    // target 974 => gross (974 + 3 + 3) / 0.98 = 1000 => 10 shares at 100.
    it('grosses the target amount up by the fees and rounds the shares up', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await expect(service.getBrokerbotSellShares({} as never, 974)).resolves.toEqual({
        targetAmount: 974,
        shares: 10,
        pricePerShare: 97.4,
        currency: BrokerbotCurrency.CHF,
      });
    });

    it('always sells at least one share', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 1000 });

      await expect(service.getBrokerbotSellShares({} as never, 1)).resolves.toMatchObject({ shares: 1 });
    });

    // A fee rate at or above 100% makes the gross-up divisor non-positive; falling back to the
    // target amount keeps the calculation defined instead of producing a negative share count.
    it('falls back to the target amount when the fee rate leaves no margin', async () => {
      feeService.getUserFee.mockResolvedValue({
        dfx: { rate: 1, fixed: 0 },
        bank: { rate: 0, fixed: 0 },
        partner: { rate: 0, fixed: 0 },
        network: 0,
      });
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await expect(service.getBrokerbotSellShares({} as never, 1000)).resolves.toMatchObject({ shares: 10 });
    });

    it('honours an explicit currency', async () => {
      blockchainService.getBrokerbotPrice.mockResolvedValue({ pricePerShare: 100 });

      await expect(service.getBrokerbotSellShares({} as never, 100, BrokerbotCurrency.EUR)).resolves.toMatchObject({
        currency: BrokerbotCurrency.EUR,
      });
    });
  });
});
