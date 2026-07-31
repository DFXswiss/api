import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
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
    it.each(['NaN', 'Infinity', '1.9', '1e+21', '-1', '0', ' 12 ', '2147483648'])(
      'looks up %j as a label, never as an id',
      async (idOrLabel) => {
        jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

        await expect(service.getPaymentRoute(idOrLabel)).rejects.toThrow('Payment route not found');

        expect(depositRouteRepo.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ route: { label: idOrLabel } }) }),
        );
      },
    );

    it('still resolves a well-formed id through the id branch', async () => {
      jest.spyOn(depositRouteRepo, 'findOne').mockResolvedValue(undefined);

      await expect(service.getPaymentRoute('42')).rejects.toThrow('Payment route not found');

      expect(depositRouteRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 42 }) }),
      );
    });
  });
});
