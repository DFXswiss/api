import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { DepositRouteService } from 'src/subdomains/supporting/address-pool/route/deposit-route.service';
import { PaymentLinkDtoMapper } from '../../dto/payment-link-dto.mapper';
import { PaymentLinkDto } from '../../dto/payment-link.dto';
import { PaymentLink } from '../../entities/payment-link.entity';
import { StickerQrMode, StickerType } from '../../enums';
import { OCPStickerService } from '../../services/ocp-sticker.service';
import { PaymentLinkPaymentService } from '../../services/payment-link-payment.service';
import { PaymentLinkService } from '../../services/payment-link.service';
import { PaymentMerchantService } from '../../services/payment-merchant.service';
import { PaymentLinkController } from '../payment-link.controller';

describe('PaymentLinkController', () => {
  let controller: PaymentLinkController;

  let userDataService: UserDataService;
  let paymentLinkService: PaymentLinkService;
  let paymentLinkPaymentService: PaymentLinkPaymentService;
  let depositRouteService: DepositRouteService;
  let paymentLinkStickerService: OCPStickerService;
  let paymentMerchantService: PaymentMerchantService;

  const jwt: JwtPayload = { role: UserRole.USER, ip: '1.1.1.1', account: 1, user: 7 } as JwtPayload;

  beforeEach(async () => {
    userDataService = createMock<UserDataService>();
    paymentLinkService = createMock<PaymentLinkService>();
    paymentLinkPaymentService = createMock<PaymentLinkPaymentService>();
    depositRouteService = createMock<DepositRouteService>();
    paymentLinkStickerService = createMock<OCPStickerService>();
    paymentMerchantService = createMock<PaymentMerchantService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        PaymentLinkController,
        { provide: UserDataService, useValue: userDataService },
        { provide: PaymentLinkService, useValue: paymentLinkService },
        { provide: PaymentLinkPaymentService, useValue: paymentLinkPaymentService },
        { provide: DepositRouteService, useValue: depositRouteService },
        { provide: OCPStickerService, useValue: paymentLinkStickerService },
        { provide: PaymentMerchantService, useValue: paymentMerchantService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<PaymentLinkController>(PaymentLinkController);
  });

  describe('linkId parsing', () => {
    beforeEach(() => {
      jest.spyOn(paymentLinkService, 'getOrThrow').mockResolvedValue({ payments: [] } as unknown as PaymentLink);
      // The mapper needs a fully-populated entity; this suite only cares how linkId was parsed.
      jest.spyOn(PaymentLinkDtoMapper, 'toLinkDto').mockReturnValue({} as PaymentLinkDto);
    });

    // Regression: `+linkId` handed Postgres 'Infinity'/'1.9'/'1e+21' as integers -> 500. linkId is only
    // one of several optional lookup keys, so a malformed value is dropped and the request still
    // resolves via externalLinkId/externalPaymentId — which is what the falsy NaN did implicitly.
    it.each(['NaN', 'Infinity', '1.9', '1e+21', '-1', '2147483648', 'abc', 'undefined', '0'])(
      'drops the malformed linkId %j instead of passing it to the id lookup',
      async (linkId) => {
        await controller.getAllPaymentLinks(jwt, linkId, 'shop-1', undefined);

        expect(paymentLinkService.getOrThrow).toHaveBeenCalledWith(7, undefined, 'shop-1', undefined);
      },
    );

    it.each(['42', ' 42 '])('still resolves the well-formed linkId %j', async (linkId) => {
      await controller.getAllPaymentLinks(jwt, linkId, undefined, undefined);

      expect(paymentLinkService.getOrThrow).toHaveBeenCalledWith(7, 42, undefined, undefined);
    });
  });

  describe('assignPaymentLink', () => {
    // The presence check must run on the PARSED id: a malformed linkId leaves no usable identifier,
    // and this endpoint has no auth guard, so reaching the service with both absent would let the
    // query match an arbitrary unassigned link.
    it.each(['abc', 'Infinity', '1e+21', '0', '2147483648'])(
      'rejects a malformed linkId %j when no externalLinkId is supplied',
      async (linkId) => {
        await expect(
          controller.assignPaymentLink(linkId, undefined, { publicName: 'attacker' } as never),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(paymentLinkService.assignPaymentLink).not.toHaveBeenCalled();
      },
    );

    it('ignores a malformed linkId when an externalLinkId is supplied', async () => {
      jest.spyOn(PaymentLinkDtoMapper, 'toLinkDto').mockReturnValue({} as PaymentLinkDto);
      jest.spyOn(paymentLinkService, 'assignPaymentLink').mockResolvedValue({} as PaymentLink);

      await controller.assignPaymentLink('abc', 'shop-1', { publicName: 'shop' } as never);

      expect(paymentLinkService.assignPaymentLink).toHaveBeenCalledWith(undefined, 'shop-1', { publicName: 'shop' });
    });
  });

  describe('generateOcpStickers ids parsing', () => {
    const run = (ids: string) =>
      controller.generateOcpStickers(
        undefined,
        'my-route',
        undefined,
        ids,
        StickerType.BITCOIN_FOCUS,
        'en',
        StickerQrMode.CUSTOMER,
        { set: jest.fn() } as unknown as Response,
      );

    // Regression: `Number.isInteger(+id)` accepts both of these, and they reached Postgres as
    // out-of-range integers on an endpoint reachable without any authentication.
    it.each(['1e+21', '2147483648', 'Infinity', '1.9', '0x10', '-1', '0', ''])('rejects ids=%j', async (ids) => {
      await expect(run(ids)).rejects.toBeInstanceOf(BadRequestException);
      expect(paymentLinkStickerService.generateOcpStickersPdf).not.toHaveBeenCalled();
    });

    it('accepts a comma-separated list of well-formed ids', async () => {
      jest
        .spyOn(paymentLinkStickerService, 'generateOcpStickersPdf')
        .mockResolvedValue(Buffer.from('pdf') as unknown as never);

      await run('1, 2,3');

      expect(paymentLinkStickerService.generateOcpStickersPdf).toHaveBeenCalledWith(
        'my-route',
        undefined,
        [1, 2, 3],
        StickerType.BITCOIN_FOCUS,
        'en',
        StickerQrMode.CUSTOMER,
        undefined,
      );
    });
  });
});
