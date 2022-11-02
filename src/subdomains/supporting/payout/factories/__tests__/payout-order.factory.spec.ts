import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../entities/payout-order.entity';
import { createDefaultPayoutOrder } from '../../entities/__mocks__/payout-order.entity.mock';
import { createCustomPayoutRequest } from '../../interfaces/__mocks__/payout-request.mock';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutOrderFactory } from '../payout-order.factory';

describe('PayoutOrderFactory', () => {
  let order: PayoutOrder;

  let repository: PayoutOrderRepository;
  let factory: PayoutOrderFactory;

  let repositoryCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    order = createDefaultPayoutOrder();
    repository = mock<PayoutOrderRepository>();
    factory = new PayoutOrderFactory(repository);

    repositoryCreateSpy = jest.spyOn(repository, 'create').mockImplementation(() => order);
  });

  afterEach(() => {
    repositoryCreateSpy.mockClear();
  });

  describe('#createOrder(...)', () => {
    it('calls repo create(...) with correct parameters', () => {
      factory.createOrder(createCustomPayoutRequest({ asset: createCustomAsset({ dexName: 'TSLA' }) }));

      expect(repositoryCreateSpy).toBeCalledTimes(1);
      expect(repositoryCreateSpy).toBeCalledWith({
        context: PayoutOrderContext.BUY_CRYPTO,
        correlationId: 'CID_01',
        chain: Blockchain.DEFICHAIN,
        asset: createCustomAsset({ dexName: 'TSLA' }),
        amount: 1,
        destinationAddress: 'ADDR_01',
        status: PayoutOrderStatus.CREATED,
      });
    });
  });
});
