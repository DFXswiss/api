import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { DepositRouteService } from 'src/subdomains/supporting/address-pool/route/deposit-route.service';
import { CreateInvoicePaymentDto } from '../../dto/create-invoice-payment.dto';
import { PaymentLinkRepository } from '../../repositories/payment-link.repository';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
import { PaymentLinkPaymentService } from '../payment-link-payment.service';
import { PaymentLinkService } from '../payment-link.service';
import { PaymentQuoteService } from '../payment-quote.service';

describe('PaymentLinkService id guards', () => {
  let service: PaymentLinkService;

  let paymentLinkRepo: PaymentLinkRepository;
  let depositRouteService: DepositRouteService;

  beforeEach(async () => {
    paymentLinkRepo = createMock<PaymentLinkRepository>();
    depositRouteService = createMock<DepositRouteService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        PaymentLinkService,
        { provide: PaymentLinkRepository, useValue: paymentLinkRepo },
        { provide: PaymentLinkPaymentService, useValue: createMock<PaymentLinkPaymentService>() },
        { provide: PaymentQuoteService, useValue: createMock<PaymentQuoteService>() },
        { provide: UserDataService, useValue: createMock<UserDataService>() },
        { provide: DepositRouteService, useValue: depositRouteService },
        { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<PaymentLinkService>(PaymentLinkService);
  });

  describe('assignPaymentLink', () => {
    // PUT /v1/paymentLink/assign is unauthenticated. With both identifiers absent the `where` reduces
    // to { status: UNASSIGNED } — TypeORM drops undefined keys — so the query would match an
    // arbitrary merchant's unassigned link and re-point it at the caller's route.
    it('refuses to query when neither identifier is usable', async () => {
      await expect(
        service.assignPaymentLink(undefined, undefined, { publicName: 'attacker' } as never),
      ).rejects.toThrow(BadRequestException);

      expect(paymentLinkRepo.findOne).not.toHaveBeenCalled();
    });

    it('still queries when an id is supplied', async () => {
      jest.spyOn(paymentLinkRepo, 'findOne').mockResolvedValue(null);

      await expect(service.assignPaymentLink(42, undefined, { publicName: 'shop' } as never)).rejects.toThrow(
        'Payment link not found',
      );

      expect(paymentLinkRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 42 }) }),
      );
    });

    it('still queries when only an externalId is supplied', async () => {
      jest.spyOn(paymentLinkRepo, 'findOne').mockResolvedValue(null);

      await expect(service.assignPaymentLink(undefined, 'shop-1', { publicName: 'shop' } as never)).rejects.toThrow(
        'Payment link not found',
      );

      expect(paymentLinkRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ externalId: 'shop-1' }) }),
      );
    });
  });

  describe('createInvoice', () => {
    // GET /v1/paymentLink/payment and /v1/plp are unauthenticated, and `+dto.routeId` handed Postgres
    // NaN/Infinity/1e+21 as integers. Validated at point of use because `route` wins over `routeId`.
    it.each(['NaN', 'Infinity', '1.9', '1e+21', 'abc', '0', '2147483648'])(
      'rejects routeId %j before it reaches the route lookup',
      async (routeId) => {
        await expect(service.createInvoice({ routeId } as CreateInvoicePaymentDto)).rejects.toThrow(
          BadRequestException,
        );

        expect(depositRouteService.getById).not.toHaveBeenCalled();
      },
    );

    it('ignores a malformed routeId when a route label is supplied instead', async () => {
      jest.spyOn(depositRouteService, 'getByLabel').mockResolvedValue(undefined);

      await expect(
        service.createInvoice({ route: 'my-label', routeId: 'abc' } as CreateInvoicePaymentDto),
      ).rejects.toThrow('Only Lightning routes are allowed');

      expect(depositRouteService.getByLabel).toHaveBeenCalledWith(undefined, 'my-label');
      expect(depositRouteService.getById).not.toHaveBeenCalled();
    });

    it('passes a well-formed routeId through as a number', async () => {
      jest.spyOn(depositRouteService, 'getById').mockResolvedValue(undefined);

      await expect(service.createInvoice({ routeId: ' 42 ' } as CreateInvoicePaymentDto)).rejects.toThrow(
        'Only Lightning routes are allowed',
      );

      expect(depositRouteService.getById).toHaveBeenCalledWith(42);
    });
  });
});
