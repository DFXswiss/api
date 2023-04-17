import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyFiatService } from '../../process/buy-fiat.service';
import { SellController } from '../sell.controller';
import { SellService } from '../sell.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomSell, createDefaultSell } from '../__mocks__/sell.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createCustomDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TransactionSpecificationService } from 'src/shared/payment/services/transaction-specification.service';

describe('SellController', () => {
  let controller: SellController;

  let sellService: SellService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;
  let paymentInfoService: PaymentInfoService;
  let transactionSpecificationService: TransactionSpecificationService;

  beforeEach(async () => {
    sellService = createMock<SellService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionSpecificationService = createMock<TransactionSpecificationService>();
    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellController,
        { provide: SellService, useValue: sellService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: TransactionSpecificationService, useValue: transactionSpecificationService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<SellController>(SellController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
