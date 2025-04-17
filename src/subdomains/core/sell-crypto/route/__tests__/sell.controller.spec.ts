import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BuyFiatService } from '../../process/services/buy-fiat.service';
import { SellController } from '../sell.controller';
import { SellService } from '../sell.service';

describe('SellController', () => {
  let controller: SellController;

  let sellService: SellService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;
  let paymentInfoService: PaymentInfoService;
  let transactionHelper: TransactionHelper;
  let cryptoService: CryptoService;
  let transactionRequestService: TransactionRequestService;
  let assetService: AssetService;
  let transactionService: TransactionService;
  let fiatService: FiatService;
  let swissQrService: SwissQRService;

  beforeEach(async () => {
    sellService = createMock<SellService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();
    cryptoService = createMock<CryptoService>();
    transactionRequestService = createMock<TransactionRequestService>();
    assetService = createMock<AssetService>();
    transactionService = createMock<TransactionService>();
    fiatService = createMock<FiatService>();
    swissQrService = createMock<SwissQRService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellController,
        { provide: SellService, useValue: sellService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CryptoService, useValue: cryptoService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: AssetService, useValue: assetService },
        { provide: TransactionService, useValue: transactionService },
        { provide: FiatService, useValue: fiatService },
        { provide: SwissQRService, useValue: swissQrService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<SellController>(SellController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
