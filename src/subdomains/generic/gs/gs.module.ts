import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { BlockchainModule } from 'src/integration/blockchain/blockchain.module';
import { IntegrationModule } from 'src/integration/integration.module';
import { LetterModule } from 'src/integration/letter/letter.module';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { ReferralModule } from 'src/subdomains/core/referral/referral.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { AddressPoolModule } from 'src/subdomains/supporting/address-pool/address-pool.module';
import { BankTxModule } from 'src/subdomains/supporting/bank-tx/bank-tx.module';
import { BankModule } from 'src/subdomains/supporting/bank/bank.module';
import { FiatOutputModule } from 'src/subdomains/supporting/fiat-output/fiat-output.module';
import { NotificationModule } from 'src/subdomains/supporting/notification/notification.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { TransactionModule } from 'src/subdomains/supporting/payment/transaction.module';
import { SupportIssueModule } from 'src/subdomains/supporting/support-issue/support-issue.module';
import { KycModule } from '../kyc/kyc.module';
import { UserModule } from '../user/user.module';
import { GsEvmController } from './gs-evm.controller';
import { GsEvmService } from './gs-evm.service';
import { GsController } from './gs.controller';
import { GsService } from './gs.service';
import { DebugQueryTreeSizeMiddleware } from './middleware/debug-query-tree-size.middleware';

@Module({
  imports: [
    SharedModule,
    BlockchainModule,
    IntegrationModule,
    AddressPoolModule,
    ReferralModule,
    BuyCryptoModule,
    SellCryptoModule,
    NotificationModule,
    UserModule,
    LetterModule,
    BankTxModule,
    PayInModule,
    FiatOutputModule,
    KycModule,
    TransactionModule,
    SupportIssueModule,
    BankModule,
  ],
  controllers: [GsController, GsEvmController],
  providers: [GsService, GsEvmService],
  exports: [],
})
export class GsModule implements NestModule {
  // Bind the WHERE-tree size cap as a middleware (not a pipe). NestJS runs middleware
  // before guards/interceptors/pipes, so this fires before the global `ValidationPipe`'s
  // recursive `plainToInstance` would stack-overflow on a pathological linear NOT-chain.
  //
  // `version` is REQUIRED — `main.ts` calls `app.enableVersioning({ type: URI })` and the
  // production routes live at `/v1/...`. NestJS' `RouteInfoPathExtractor` prepends the
  // version segment only when `version` is set on the route info; without it the
  // middleware would register at literal `/gs/debug` and never match the real
  // `/v1/gs/debug` URL — i.e. the cap would silently never fire. Uses `GetConfig()`
  // (returns a fresh `Configuration` instance, no NestJS DI needed) rather than the
  // lazy-initialised `Config` export, so the binding is robust to module-init ordering.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DebugQueryTreeSizeMiddleware)
      .forRoutes({ path: 'gs/debug', method: RequestMethod.POST, version: GetConfig().defaultVersion });
  }
}
