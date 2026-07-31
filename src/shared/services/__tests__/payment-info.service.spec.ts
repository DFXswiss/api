import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { GetBuyPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/buy/dto/get-buy-payment-info.dto';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { PaymentInfoService } from '../payment-info.service';

// The trade-approval gate reads user.wallet. Callers that load the user without the wallet relation see
// an undefined wallet, which silently disables both escape hatches below - so these assert the gate
// against a user that actually carries one.
describe('PaymentInfoService buyCheck trade-approval gate', () => {
  let service: PaymentInfoService;
  let fiatService: FiatService;
  let assetService: AssetService;

  const currency = { id: 2, name: 'EUR', sellable: true } as Fiat;
  const asset = { id: 10, name: 'BTC', buyable: true } as Asset;

  function dto(): GetBuyPaymentInfoDto {
    return { amount: 100, currency, asset, paymentMethod: FiatPaymentMethod.BANK } as GetBuyPaymentInfoDto;
  }

  function user(wallet: Record<string, unknown>, tradeApprovalDate?: Date): User {
    return { id: 1, userData: { kycLevel: KycLevel.LEVEL_50, tradeApprovalDate }, wallet } as unknown as User;
  }

  beforeEach(() => {
    fiatService = createMock<FiatService>();
    assetService = createMock<AssetService>();
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue(currency);
    jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    service = new PaymentInfoService(fiatService, assetService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lets an autoTradeApproval wallet through without a tradeApprovalDate', async () => {
    await expect(
      service.buyCheck(dto(), undefined, user({ autoTradeApproval: true, amlRuleList: [] })),
    ).resolves.toBeDefined();
  });

  it('still rejects a wallet without autoTradeApproval and without a tradeApprovalDate', async () => {
    await expect(
      service.buyCheck(dto(), undefined, user({ autoTradeApproval: false, amlRuleList: [] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a wallet without autoTradeApproval once a tradeApprovalDate is set', async () => {
    await expect(
      service.buyCheck(dto(), undefined, user({ autoTradeApproval: false, amlRuleList: [] }, new Date())),
    ).resolves.toBeDefined();
  });
});
