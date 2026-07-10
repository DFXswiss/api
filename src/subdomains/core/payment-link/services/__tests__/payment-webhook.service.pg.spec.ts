import { createMock } from '@golevelup/ts-jest';
import { DataType, newDb } from 'pg-mem';
import * as ConfigModule from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentLinkDtoMapper } from '../../dto/payment-link-dto.mapper';
import { PaymentLink } from '../../entities/payment-link.entity';
import { PaymentLinkRepository } from '../../repositories/payment-link.repository';
import { PaymentWebhookService } from '../payment-webhook.service';

const WEBHOOK_URL = 'https://merchant.example.com/hook';

// the real PaymentLink entity cannot be registered standalone (its relations pull in the whole
// entity graph), so this table mirrors the columns of migration 1783697064952 that the service
// updates - crucially with the same quoted camelCase names
@Entity({ name: 'payment_link' })
class PaymentLinkTable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  webhookUrl?: string;

  @Column({ type: 'int', default: 0 })
  webhookFailCount: number;

  @Column({ type: 'timestamp', nullable: true })
  webhookLastFailedAt?: Date;
}

// runs the service's UPDATE statements against a Postgres-semantics engine (pg-mem), because the
// fail-counter increment is a raw SQL fragment: a mocked repository can only assert the fragment's
// text, not that it is valid SQL that actually increments the stored value
describe('PaymentWebhookService (postgres semantics)', () => {
  let dataSource: DataSource;
  let httpService: jest.Mocked<HttpService>;
  let service: PaymentWebhookService;

  beforeAll(async () => {
    (ConfigModule as Record<string, unknown>).Config = {
      payment: { webhookPrivateKey: 'test-key', webhookFailureThreshold: 3, webhookFailureCooldown: 3600 },
    };
    jest.spyOn(Util, 'createSign').mockReturnValue('mock-signature');
    jest
      .spyOn(PaymentLinkDtoMapper, 'toLinkDto')
      .mockImplementation((link: PaymentLink) => ({ webhookUrl: link.webhookUrl }) as never);

    const db = newDb();
    // TypeORM runs SELECT version() / current_database() on connect; pg-mem does not ship them
    db.public.registerFunction({ name: 'version', returns: DataType.text, implementation: () => 'PostgreSQL 15.0' });
    db.public.registerFunction({ name: 'current_database', returns: DataType.text, implementation: () => 'test' });

    dataSource = (await db.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [PaymentLinkTable],
      synchronize: true,
    })) as DataSource;
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await dataSource.getRepository(PaymentLinkTable).clear();

    httpService = createMock<HttpService>();
    service = new PaymentWebhookService(
      httpService,
      dataSource.getRepository(PaymentLinkTable) as unknown as PaymentLinkRepository,
    );
  });

  async function seedRow(webhookFailCount: number): Promise<PaymentLinkTable> {
    return dataSource.getRepository(PaymentLinkTable).save({ webhookUrl: WEBHOOK_URL, webhookFailCount });
  }

  function createLink(row: PaymentLinkTable, snapshotFailCount: number): PaymentLink {
    const link = new PaymentLink();
    link.id = row.id;
    link.uniqueId = 'pl_test';
    link.webhookUrl = WEBHOOK_URL;
    link.webhookFailCount = snapshotFailCount;

    return link;
  }

  it('persists the failure counter and timestamp on a failed send', async () => {
    const row = await seedRow(0);
    httpService.post.mockRejectedValueOnce(new Error('connect ECONNREFUSED 0.0.0.0:9999'));

    await expect(service['doSendWebhook'](createLink(row, 0))).rejects.toThrow('ECONNREFUSED');

    const updated = await dataSource.getRepository(PaymentLinkTable).findOneByOrFail({ id: row.id });
    expect(updated.webhookFailCount).toBe(1);
    expect(updated.webhookLastFailedAt).toBeInstanceOf(Date);
  });

  it('increments from the stored value, not the entity snapshot, so parallel events do not collapse', async () => {
    const row = await seedRow(5);
    httpService.post.mockRejectedValueOnce(new Error('boom'));

    // entity loaded before the other events' failures were recorded
    await expect(service['doSendWebhook'](createLink(row, 0))).rejects.toThrow('boom');

    const updated = await dataSource.getRepository(PaymentLinkTable).findOneByOrFail({ id: row.id });
    expect(updated.webhookFailCount).toBe(6);
  });

  it('resets the counter and timestamp on a successful send', async () => {
    const row = await seedRow(3);
    httpService.post.mockResolvedValueOnce(undefined as never);

    await service['doSendWebhook'](createLink(row, 3));

    const updated = await dataSource.getRepository(PaymentLinkTable).findOneByOrFail({ id: row.id });
    expect(updated.webhookFailCount).toBe(0);
    expect(updated.webhookLastFailedAt).toBeNull();
  });
});
