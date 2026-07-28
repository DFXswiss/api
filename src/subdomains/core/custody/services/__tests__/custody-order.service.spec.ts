import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDto } from 'src/shared/models/asset/dto/asset.dto';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapPaymentInfoDto } from 'src/subdomains/core/buy-crypto/routes/swap/dto/swap-payment-info.dto';
import { Swap } from 'src/subdomains/core/buy-crypto/routes/swap/swap.entity';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { FeeDto } from 'src/subdomains/supporting/payment/dto/fee.dto';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { MinAmount } from 'src/subdomains/supporting/payment/dto/transaction-helper/min-amount.dto';
import { GetCustodyInfoDto } from '../../dto/input/get-custody-info.dto';
import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyOrderStepRepository } from '../../repositories/custody-order-step.repository';
import { CustodyOrderRepository } from '../../repositories/custody-order.repository';
import { CustodyAccountService } from '../custody-account.service';
import { CustodyOrderService } from '../custody-order.service';
import { CustodyService } from '../custody.service';
import { EquityPairService } from '../equity-pair.service';

describe('CustodyOrderService', () => {
  let service: CustodyOrderService;
  let userService: DeepMocked<UserService>;
  let custodyOrderRepo: DeepMocked<CustodyOrderRepository>;
  let custodyOrderStepRepo: DeepMocked<CustodyOrderStepRepository>;
  let custodyService: DeepMocked<CustodyService>;
  let custodyAccountService: DeepMocked<CustodyAccountService>;
  let sellService: DeepMocked<SellService>;
  let buyService: DeepMocked<BuyService>;
  let swapService: DeepMocked<SwapService>;
  let assetService: DeepMocked<AssetService>;
  let fiatService: DeepMocked<FiatService>;
  let equityPairService: DeepMocked<EquityPairService>;

  const walletUserId = 10;
  const userDataId = 100;
  const jwtAccountId = 999;
  const orderId = 50;
  const swapRouteId = 77;
  const paymentInfoId = 88;

  function custodyUser(overrides: Partial<User> = {}): User {
    return Object.assign(new User(), {
      id: walletUserId,
      userData: Object.assign(new UserData(), { id: userDataId }),
      custodyBalances: [],
      ...overrides,
    });
  }

  function jwtPayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
    return {
      user: walletUserId,
      account: jwtAccountId,
      role: UserRole.USER,
      ip: '127.0.0.1',
      ...overrides,
    };
  }

  function receiveOrderDto(overrides: Partial<GetCustodyInfoDto> = {}): GetCustodyInfoDto {
    return Object.assign(new GetCustodyInfoDto(), {
      type: CustodyOrderType.RECEIVE,
      sourceAsset: 'ETH',
      targetAsset: 'ZCHF',
      sourceAmount: 1,
      paymentMethod: FiatPaymentMethod.BANK,
      ...overrides,
    });
  }

  function custodyAsset(name: string, id: number): Asset {
    return Object.assign(new Asset(), {
      id,
      name,
      blockchain: Blockchain.ETHEREUM,
    });
  }

  function zeroFee(): FeeDto {
    return {
      min: 0,
      rate: 0,
      fixed: 0,
      dfx: 0,
      network: 0,
      platform: 0,
      bank: 0,
      total: 0,
    };
  }

  function assetDto(name: string): AssetDto {
    return { name } as AssetDto;
  }

  function swapPaymentInfo(overrides: Partial<SwapPaymentInfoDto> = {}): SwapPaymentInfoDto {
    const minDeposit: MinAmount = { amount: 0, asset: 'ETH' };

    return {
      id: paymentInfoId,
      uid: 'swap-uid',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      routeId: swapRouteId,
      depositAddress: '0xdeposit',
      blockchain: Blockchain.ETHEREUM,
      minDeposit,
      fee: 0,
      minFee: 0,
      fees: zeroFee(),
      minVolume: 0,
      maxVolume: 0,
      amount: 1,
      sourceAsset: assetDto('ETH'),
      minFeeTarget: 0,
      feesTarget: zeroFee(),
      minVolumeTarget: 0,
      maxVolumeTarget: 0,
      exchangeRate: 1,
      rate: 1,
      exactPrice: true,
      priceSteps: [],
      estimatedAmount: 1,
      targetAsset: assetDto('ZCHF'),
      paymentRequest: undefined,
      isValid: true,
      error: undefined,
      ...overrides,
    };
  }

  function custodyOrder(overrides: Partial<CustodyOrder> = {}): CustodyOrder {
    return Object.assign(new CustodyOrder(), {
      id: orderId,
      type: CustodyOrderType.RECEIVE,
      status: CustodyOrderStatus.CREATED,
      user: custodyUser(),
      ...overrides,
    });
  }

  function mockReceiveHappyPath(user: User): void {
    userService.getUser.mockResolvedValue(user);
    custodyAccountService.requireActingAllowed.mockResolvedValue(undefined);

    const sourceAsset = custodyAsset('ETH', 1);
    const targetAsset = custodyAsset('ZCHF', 2);
    assetService.getAssetsByName.mockImplementation(async (name: string): Promise<Asset[]> => {
      if (name === 'ETH') return [sourceAsset];
      if (name === 'ZCHF') return [targetAsset];
      return [];
    });

    const paymentInfo = swapPaymentInfo();
    swapService.createSwapPaymentInfo.mockResolvedValue(paymentInfo);
    swapService.getById.mockResolvedValue(Object.assign(new Swap(), { id: swapRouteId }));

    custodyOrderRepo.create.mockImplementation((dto: object) =>
      Object.assign(new CustodyOrder(), { status: CustodyOrderStatus.CREATED }, dto),
    );
    custodyOrderRepo.save.mockImplementation(async (order: CustodyOrder) =>
      Object.assign(order, {
        id: orderId,
        status: order.status,
        type: order.type,
      }),
    );
  }

  beforeEach(() => {
    userService = createMock<UserService>();
    custodyOrderRepo = createMock<CustodyOrderRepository>();
    custodyOrderStepRepo = createMock<CustodyOrderStepRepository>();
    custodyService = createMock<CustodyService>();
    custodyAccountService = createMock<CustodyAccountService>();
    sellService = createMock<SellService>();
    buyService = createMock<BuyService>();
    swapService = createMock<SwapService>();
    assetService = createMock<AssetService>();
    fiatService = createMock<FiatService>();
    equityPairService = createMock<EquityPairService>();

    service = new CustodyOrderService(
      userService,
      custodyOrderRepo,
      custodyOrderStepRepo,
      custodyService,
      custodyAccountService,
      sellService,
      buyService,
      swapService,
      assetService,
      fiatService,
      equityPairService,
    );
  });

  describe('createOrder', () => {
    it('rejects createOrder when acting is narrowed to inspection', async () => {
      const user = custodyUser();
      userService.getUser.mockResolvedValue(user);
      custodyAccountService.requireActingAllowed.mockRejectedValueOnce(
        new ForbiddenException('This Safe is limited to inspection, acting is not permitted'),
      );

      await expect(service.createOrder(jwtPayload(), receiveOrderDto())).rejects.toThrow(ForbiddenException);

      expect(custodyOrderRepo.save).not.toHaveBeenCalled();
      expect(custodyOrderRepo.create).not.toHaveBeenCalled();
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it("calls requireActingAllowed with the loaded user's userData id, not the jwt ids", async () => {
      const user = custodyUser();
      const jwt = jwtPayload({ user: walletUserId, account: jwtAccountId });

      expect(jwt.user).not.toBe(user.userData.id);
      expect(jwt.account).not.toBe(user.userData.id);
      expect(jwt.user).not.toBe(jwt.account);

      mockReceiveHappyPath(user);

      const result = await service.createOrder(jwt, receiveOrderDto());

      expect(custodyAccountService.requireActingAllowed).toHaveBeenCalledWith(user.userData.id);
      expect(custodyAccountService.requireActingAllowed).not.toHaveBeenCalledWith(jwt.user);
      expect(custodyAccountService.requireActingAllowed).not.toHaveBeenCalledWith(jwt.account);
      expect(result.orderId).toBe(orderId);
      expect(result.type).toBe(CustodyOrderType.RECEIVE);
    });
  });

  describe('confirmOrder', () => {
    it('rejects confirmOrder when acting is narrowed to inspection and does not update the order', async () => {
      const order = custodyOrder();
      custodyOrderRepo.findOne.mockResolvedValue(order);
      custodyAccountService.requireActingAllowed.mockRejectedValueOnce(
        new ForbiddenException('This Safe is limited to inspection, acting is not permitted'),
      );

      await expect(service.confirmOrder(walletUserId, orderId)).rejects.toThrow(ForbiddenException);

      expect(custodyOrderRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a stranger before requireActingAllowed so ownership short-circuits the narrowing check', async () => {
      const order = custodyOrder();
      const strangerId = 9999;
      expect(strangerId).not.toBe(order.user.id);

      custodyOrderRepo.findOne.mockResolvedValue(order);

      await expect(service.confirmOrder(strangerId, orderId)).rejects.toThrow(
        new ForbiddenException('Order is not from current user'),
      );

      expect(custodyAccountService.requireActingAllowed).not.toHaveBeenCalled();
    });

    it('calls requireActingAllowed with order.user.userData.id and confirms when acting is allowed', async () => {
      const order = custodyOrder();
      custodyOrderRepo.findOne.mockResolvedValue(order);
      custodyAccountService.requireActingAllowed.mockResolvedValue(undefined);
      custodyOrderRepo.update.mockResolvedValue(undefined);

      await service.confirmOrder(walletUserId, orderId);

      expect(custodyAccountService.requireActingAllowed).toHaveBeenCalledWith(order.user.userData.id);
      expect(custodyOrderRepo.update).toHaveBeenCalledWith(
        order.id,
        expect.objectContaining({ status: CustodyOrderStatus.CONFIRMED }),
      );
    });
  });
});
