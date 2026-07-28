import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { AssetPrice } from 'src/subdomains/supporting/pricing/domain/entities/asset-price.entity';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { RefService } from '../../../referral/process/ref.service';
import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyBalanceRepository } from '../../repositories/custody-balance.repository';
import { CustodyOrderRepository } from '../../repositories/custody-order.repository';
import { CustodyService } from '../custody.service';

describe('CustodyService', () => {
  let service: CustodyService;
  let userDataService: DeepMocked<UserDataService>;
  let custodyOrderRepo: DeepMocked<CustodyOrderRepository>;
  let assetPricesService: DeepMocked<AssetPricesService>;

  const asset = createCustomAsset({ id: 42, name: 'BTC' });
  const custodyUser = createCustomUser({ id: 7, role: UserRole.CUSTODY });
  const accountId = 100;

  beforeEach(() => {
    userDataService = createMock<UserDataService>();
    custodyOrderRepo = createMock<CustodyOrderRepository>();
    assetPricesService = createMock<AssetPricesService>();

    service = new CustodyService(
      createMock<UserService>(),
      userDataService,
      createMock<WalletService>(),
      createMock<RefService>(),
      createMock<AuthService>(),
      custodyOrderRepo,
      createMock<CustodyBalanceRepository>(),
      assetPricesService,
      createMock<AssetService>(),
    );

    userDataService.getUserData.mockResolvedValue(
      Object.assign(new UserData(), { id: accountId, users: [custodyUser] }),
    );
  });

  function depositOrder(updated: Date, amount: number): CustodyOrder {
    return Object.assign(new CustodyOrder(), {
      id: 1,
      type: CustodyOrderType.DEPOSIT,
      status: CustodyOrderStatus.COMPLETED,
      inputAmount: amount,
      inputAsset: asset,
      user: custodyUser,
      updated,
    });
  }

  function assetPrice(created: Date, priceChf: number, priceEur: number, priceUsd: number): AssetPrice {
    return Object.assign(new AssetPrice(), {
      id: created.getTime(),
      asset,
      created,
      priceChf,
      priceEur,
      priceUsd,
    });
  }

  describe('getUserCustodyHistory', () => {
    it('throws when the account is missing', async () => {
      userDataService.getUserData.mockResolvedValue(null);

      await expect(service.getUserCustodyHistory(accountId)).rejects.toThrow(NotFoundException);
    });

    it('returns an empty history when there are no completed orders', async () => {
      custodyOrderRepo.find.mockResolvedValue([]);

      await expect(service.getUserCustodyHistory(accountId)).resolves.toEqual({ totalValue: [] });
    });

    it('uses a single price row per asset unchanged (balance × price)', async () => {
      const balance = 2;
      const priceChf = 100;
      const priceEur = 90;
      const priceUsd = 110;

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([
        assetPrice(new Date('2025-11-01T09:00:00.000Z'), priceChf, priceEur, priceUsd),
      ]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      expect(result.totalValue[0].value).toEqual({
        chf: balance * priceChf,
        eur: balance * priceEur,
        usd: balance * priceUsd,
      });
    });

    it('uses the latest price per asset when multiple price rows fall on the same UTC day', async () => {
      const balance = 2;
      // Later timestamp first in the array — selection must use created, not array order.
      const laterPrice = assetPrice(new Date('2025-11-01T23:01:00.000Z'), 150, 140, 160);
      const earlierPrice = assetPrice(new Date('2025-11-01T09:00:00.000Z'), 100, 90, 110);

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([laterPrice, earlierPrice]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      // Must be balance × later price (300), not the sum of both (500).
      expect(result.totalValue[0].value).toEqual({
        chf: balance * laterPrice.priceChf,
        eur: balance * laterPrice.priceEur,
        usd: balance * laterPrice.priceUsd,
      });
    });

    it('uses the higher id when two price rows share the same created timestamp', async () => {
      const balance = 2;
      const created = new Date('2025-11-01T09:00:00.000Z');
      // Lower id first in the array — selection must use higher id, not array order.
      const lowerIdPrice = Object.assign(assetPrice(created, 100, 90, 110), { id: 1 });
      const higherIdPrice = Object.assign(assetPrice(created, 150, 140, 160), { id: 2 });

      custodyOrderRepo.find.mockResolvedValue([depositOrder(new Date('2025-11-01T08:00:00.000Z'), balance)]);
      assetPricesService.getAssetPrices.mockResolvedValue([lowerIdPrice, higherIdPrice]);

      const result = await service.getUserCustodyHistory(accountId);

      expect(result.totalValue).toHaveLength(1);
      // Must be balance × higher-id price (300), not the lower-id price (200).
      expect(result.totalValue[0].value).toEqual({
        chf: balance * higherIdPrice.priceChf,
        eur: balance * higherIdPrice.priceEur,
        usd: balance * higherIdPrice.priceUsd,
      });
    });
  });
});
