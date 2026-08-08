import { Provider, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { BankTxRepeatController } from '../bank-tx-repeat/bank-tx-repeat.controller';
import { BankTxRepeatService } from '../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnNotificationService } from '../bank-tx-return/bank-tx-return-notification.service';
import { BankTxReturnController } from '../bank-tx-return/bank-tx-return.controller';
import { BankTxReturnService } from '../bank-tx-return/bank-tx-return.service';
import { BankTxController } from '../bank-tx/bank-tx.controller';
import { BankTransactionHandler } from '../bank-tx/services/bank-transaction-handler.service';
import { BankTxBatchService } from '../bank-tx/services/bank-tx-batch.service';
import { BankTxFiatRepublicService } from '../bank-tx/services/bank-tx-fiat-republic.service';
import { BankTxFrickService } from '../bank-tx/services/bank-tx-frick.service';
import { BankTxOutgoingMatchService } from '../bank-tx/services/bank-tx-outgoing-match.service';
import { BankTxService } from '../bank-tx/services/bank-tx.service';
import { SepaParser } from '../bank-tx/services/sepa-parser.service';
import { BankTxModule } from '../bank-tx.module';

// Wiring test over the module metadata. Unlike accounting.module.spec.ts this one deliberately does
// NOT instantiate the providers: BankTxService and BankTxReturnService reference each other, and Nest
// only resolves that through the `forwardRef` wrappers the real graph supplies — in a bare test module
// the second class is still undefined at metadata time, so the compile fails for a reason that says
// nothing about this module's correctness. What is worth asserting here is the declaration itself:
// every controller, provider and export is present, and every forward reference resolves.
describe('BankTxModule', () => {
  const controllers: Type[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BankTxModule);
  const providers: Provider[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BankTxModule);
  const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, BankTxModule);
  const exports: unknown[] = Reflect.getMetadata(MODULE_METADATA.EXPORTS, BankTxModule);

  it('declares every controller', () => {
    expect(controllers).toEqual([BankTxController, BankTxReturnController, BankTxRepeatController]);
  });

  it.each([
    ['BankTxService', BankTxService],
    ['BankTxFrickService', BankTxFrickService],
    ['BankTxFiatRepublicService', BankTxFiatRepublicService],
    ['BankTxOutgoingMatchService', BankTxOutgoingMatchService],
    ['BankTxReturnService', BankTxReturnService],
    ['BankTxRepeatService', BankTxRepeatService],
    ['BankTxBatchService', BankTxBatchService],
    ['BankTxReturnNotificationService', BankTxReturnNotificationService],
    ['BankTransactionHandler', BankTransactionHandler],
    ['SepaParser', SepaParser],
  ])('declares the provider %s', (_name, token) => {
    expect(providers).toContain(token);
  });

  it('registers the webhook-to-bank_tx bridge and an importer per polled rail', () => {
    // BankTransactionHandler owns the webhook subscriptions; dropping it would silently stop every
    // pushed payin. The per-rail importers are the polling backstop behind them.
    expect(providers).toContain(BankTransactionHandler);
    expect(providers).toContain(BankTxFrickService);
    expect(providers).toContain(BankTxFiatRepublicService);
  });

  it('exports what other modules depend on', () => {
    expect(exports).toEqual([
      BankTxService,
      BankTxOutgoingMatchService,
      BankTxRepeatService,
      BankTxBatchService,
      BankTxReturnService,
    ]);
  });

  // forwardRef arguments are lazy thunks Nest only calls while resolving the graph. A broken (circular)
  // import makes one resolve to undefined, which surfaces as an opaque boot failure — resolving them
  // here turns that into a failing test instead.
  it('resolves every forward reference to a real module', () => {
    const forwardRefs = imports.filter(
      (entry): entry is { forwardRef: () => unknown } =>
        typeof (entry as { forwardRef?: unknown })?.forwardRef === 'function',
    );
    expect(forwardRefs.length).toBeGreaterThan(0);

    for (const entry of forwardRefs) {
      expect(entry.forwardRef()).toBeDefined();
    }
  });
});
