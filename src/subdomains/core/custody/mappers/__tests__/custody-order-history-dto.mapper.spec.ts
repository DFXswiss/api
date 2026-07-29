import { CustodyOrder } from '../../entities/custody-order.entity';
import { CustodyOrderStatus, CustodyOrderType } from '../../enums/custody';
import { CustodyOrderHistoryStatus } from '../../dto/output/custody-order-history.dto';
import { CustodyOrderHistoryDtoMapper } from '../custody-order-history-dto.mapper';

describe('CustodyOrderHistoryDtoMapper', () => {
  describe('map', () => {
    it('passes through both timestamps for a completed order', () => {
      const created = new Date('2026-01-08T10:00:00Z');
      const completedAt = new Date('2026-01-28T12:00:00Z');
      const order = Object.assign(new CustodyOrder(), {
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.COMPLETED,
        created,
        completedAt,
      });

      const result = CustodyOrderHistoryDtoMapper.map(order);

      expect(result.created).toEqual(created);
      expect(result.completedAt).toEqual(completedAt);
      expect(result.status).toBe(CustodyOrderHistoryStatus.COMPLETED);
    });

    it('leaves completedAt undefined for an order that never completed', () => {
      const created = new Date('2026-01-08T10:00:00Z');
      const order = Object.assign(new CustodyOrder(), {
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.CONFIRMED,
        created,
      });

      const result = CustodyOrderHistoryDtoMapper.map(order);

      // A fallback onto created would claim a valuta the order never had.
      expect(result.created).toEqual(created);
      expect(result.completedAt).toBeUndefined();
    });

    it('keeps the timestamps of each order in mapList', () => {
      const created1 = new Date('2026-01-01T00:00:00Z');
      const created2 = new Date('2026-01-15T00:00:00Z');
      const order1 = Object.assign(new CustodyOrder(), {
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.COMPLETED,
        created: created1,
        completedAt: new Date('2026-01-02T00:00:00Z'),
      });
      const order2 = Object.assign(new CustodyOrder(), {
        type: CustodyOrderType.DEPOSIT,
        status: CustodyOrderStatus.CONFIRMED,
        created: created2,
      });

      const result = CustodyOrderHistoryDtoMapper.mapList([order1, order2]);

      expect(result).toHaveLength(2);
      expect(result[0].created).toEqual(created1);
      expect(result[1].created).toEqual(created2);
    });
  });
});
