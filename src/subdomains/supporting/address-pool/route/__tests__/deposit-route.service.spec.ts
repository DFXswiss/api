import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { FindOneOptions, In } from 'typeorm';
import { DepositRoute } from '../deposit-route.entity';
import { DepositRouteRepository } from '../deposit-route.repository';
import { DepositRouteService } from '../deposit-route.service';

describe('DepositRouteService', () => {
  let service: DepositRouteService;
  let depositRouteRepo: DepositRouteRepository;

  beforeEach(async () => {
    depositRouteRepo = createMock<DepositRouteRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        DepositRouteService,
        { provide: DepositRouteRepository, useValue: depositRouteRepo },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<DepositRouteService>(DepositRouteService);
  });

  describe('getPaymentRoute', () => {
    // Regression: `!isNaN(+idOrLabel)` sent these down the id branch, so they reached Postgres as
    // integers and came back as `invalid input syntax for type integer` -> 500 on
    // GET /v1/paymentLink/recipient, which is reachable without authentication. They are not valid
    // ids, so they must be looked up as route labels instead.
    it.each(['NaN', 'Infinity', '1.9', '1e+21', '-1', '0', '0x10', '2147483648'])(
      'looks up %j as a label, never as an id',
      async (idOrLabel) => {
        jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

        await expect(service.getPaymentRoute(idOrLabel)).rejects.toThrow('Payment route not found');

        expect(depositRouteRepo.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ route: { label: idOrLabel } }) }),
        );
      },
    );

    // `?id=+42` decodes to ' 42', which resolved as id 42 before the guard existed.
    it.each(['42', ' 42 '])('still resolves the well-formed id %j through the id branch', async (idOrLabel) => {
      jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

      await expect(service.getPaymentRoute(idOrLabel)).rejects.toThrow('Payment route not found');

      expect(depositRouteRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 42 }) }),
      );
    });
  });

  describe('getByLabel scoping', () => {
    // TypeORM drops relation objects whose properties are all undefined, so with no label the base
    // where vanishes and a caller-supplied options.where becomes the only surviving condition —
    // matching across every route. The query must not be issued at all.
    it.each([undefined, null, ''])('does not query when the label is %p', async (label) => {
      const route = await service.getByLabel(undefined, label as string);

      expect(route).toBeUndefined();
      expect(depositRouteRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not query when only a caller-supplied where survives', async () => {
      const route = await service.getByLabel(undefined, undefined, {
        relations: { paymentLinks: true },
        where: { paymentLinks: [{ id: In([1, 2, 3]) }] },
      } as FindOneOptions<DepositRoute>);

      expect(route).toBeUndefined();
      expect(depositRouteRepo.findOne).not.toHaveBeenCalled();
    });

    it('still queries when a label is supplied', async () => {
      jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

      await service.getByLabel(7, 'my-label');

      expect(depositRouteRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { route: { label: 'my-label' }, user: { id: 7 } } }),
      );
    });
  });

  describe('getPaymentRoutesForPublicName scoping', () => {
    // GET /v1/paymentLink/locations has no auth guard. With publicName omitted the nested userData
    // object is all-undefined and dropped, leaving only `active` + blockchain — i.e. every merchant's
    // Lightning route, whose recipient addresses getLocations then returns.
    it.each([undefined, null, ''])('does not query when the public name is %p', async (publicName) => {
      const routes = await service.getPaymentRoutesForPublicName(publicName as string);

      expect(routes).toEqual([]);
      expect(depositRouteRepo.find).not.toHaveBeenCalled();
    });

    it('still queries when a public name is supplied', async () => {
      jest.spyOn(depositRouteRepo, 'find').mockResolvedValue([]);

      await service.getPaymentRoutesForPublicName('acme');

      expect(depositRouteRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user: { userData: { paymentLinksName: 'acme' } } }),
        }),
      );
    });
  });

  describe('getById scoping', () => {
    it.each([undefined, null, 0])('does not query when the id is %p', async (id) => {
      const route = await service.getById(
        id as number,
        {
          where: { paymentLinks: [{ id: In([1, 2, 3]) }] },
        } as FindOneOptions<DepositRoute>,
      );

      expect(route).toBeUndefined();
      expect(depositRouteRepo.findOne).not.toHaveBeenCalled();
    });

    it('still queries when an id is supplied', async () => {
      jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

      await service.getById(42);

      expect(depositRouteRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 } }));
    });
  });

  describe('getPaymentLinksFromRoute scoping', () => {
    // The reachable shape: an id filter with no route to scope it to. Without the guard the surviving
    // where is the id filter alone, returning links that belong to other routes entirely.
    it('does not query when no route is supplied', async () => {
      await expect(service.getPaymentLinksFromRoute(undefined, undefined, [1, 2, 3])).rejects.toThrow(
        'Payment route not found',
      );

      expect(depositRouteRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
