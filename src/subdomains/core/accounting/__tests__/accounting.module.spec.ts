import { createMock } from '@golevelup/ts-jest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingModule } from '../accounting.module';
import { LedgerController } from '../controllers/ledger.controller';
import { LedgerAccountRepository } from '../repositories/ledger-account.repository';
import { LedgerLegRepository } from '../repositories/ledger-leg.repository';
import { LedgerTxRepository } from '../repositories/ledger-tx.repository';
import { BankTxConsumer } from '../services/consumers/bank-tx.consumer';
import { BuyCryptoConsumer } from '../services/consumers/buy-crypto.consumer';
import { BuyFiatConsumer } from '../services/consumers/buy-fiat.consumer';
import { CryptoInputConsumer } from '../services/consumers/crypto-input.consumer';
import { ExchangeTxConsumer } from '../services/consumers/exchange-tx.consumer';
import { LiquidityMgmtConsumer } from '../services/consumers/liquidity-mgmt.consumer';
import { LiquidityOrderDexConsumer } from '../services/consumers/liquidity-order-dex.consumer';
import { PayoutOrderConsumer } from '../services/consumers/payout-order.consumer';
import { TradingOrderConsumer } from '../services/consumers/trading-order.consumer';
import { LedgerAccountService } from '../services/ledger-account.service';
import { LedgerBookingJobService } from '../services/ledger-booking-job.service';
import { LedgerBookingService } from '../services/ledger-booking.service';
import { LedgerBootstrapService } from '../services/ledger-bootstrap.service';
import { LedgerCutoverService } from '../services/ledger-cutover.service';
import { LedgerMarkService } from '../services/ledger-mark.service';
import { LedgerMarkToMarketService } from '../services/ledger-mark-to-market.service';
import { LedgerQueryService } from '../services/ledger-query.service';
import { LedgerReconciliationService } from '../services/ledger-reconciliation.service';

// Compile/wiring test: instantiate the module's own controllers + providers with every external dependency
// (repositories, SharedModule/Log/Liquidity/Notification services) mocked, then assert each core provider
// actually resolves. This catches a constructor that can no longer be satisfied or a provider dropped from
// the @Module() metadata, without booting the real TypeORM DataSource or the transitive feature modules.
describe('AccountingModule', () => {
  let testingModule: TestingModule;

  const controllers: any[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AccountingModule);
  const providers: any[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AccountingModule);

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({ controllers, providers })
      .useMocker(() => createMock())
      .compile();
  });

  afterAll(async () => {
    await testingModule?.close();
  });

  it('declares the LedgerController', () => {
    expect(controllers).toEqual([LedgerController]);
  });

  it('resolves the LedgerController', () => {
    expect(testingModule.get(LedgerController)).toBeInstanceOf(LedgerController);
  });

  const coreServices: [string, any][] = [
    ['LedgerAccountService', LedgerAccountService],
    ['LedgerBootstrapService', LedgerBootstrapService],
    ['LedgerBookingService', LedgerBookingService],
    ['LedgerMarkService', LedgerMarkService],
    ['LedgerBookingJobService', LedgerBookingJobService],
    ['LedgerCutoverService', LedgerCutoverService],
    ['LedgerMarkToMarketService', LedgerMarkToMarketService],
    ['LedgerReconciliationService', LedgerReconciliationService],
    ['LedgerQueryService', LedgerQueryService],
  ];

  it.each(coreServices)('resolves the core provider %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  const consumers: [string, any][] = [
    ['BankTxConsumer', BankTxConsumer],
    ['ExchangeTxConsumer', ExchangeTxConsumer],
    ['CryptoInputConsumer', CryptoInputConsumer],
    ['PayoutOrderConsumer', PayoutOrderConsumer],
    ['BuyCryptoConsumer', BuyCryptoConsumer],
    ['BuyFiatConsumer', BuyFiatConsumer],
    ['LiquidityMgmtConsumer', LiquidityMgmtConsumer],
    ['LiquidityOrderDexConsumer', LiquidityOrderDexConsumer],
    ['TradingOrderConsumer', TradingOrderConsumer],
  ];

  it.each(consumers)('resolves the source consumer %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  const repositories: [string, any][] = [
    ['LedgerAccountRepository', LedgerAccountRepository],
    ['LedgerTxRepository', LedgerTxRepository],
    ['LedgerLegRepository', LedgerLegRepository],
  ];

  it.each(repositories)('resolves the repository %s', (_name, token) => {
    expect(testingModule.get(token)).toBeInstanceOf(token);
  });

  it('registers every metadata provider as resolvable', () => {
    for (const token of providers) {
      expect(testingModule.get(token)).toBeDefined();
    }
  });

  it('exports nothing', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AccountingModule);
    expect(exports).toEqual([]);
  });
});
