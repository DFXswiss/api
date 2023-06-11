import { Module } from '@nestjs/common';
import { LightningModule } from 'src/integration/lightning/lightning.module';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexModule } from 'src/subdomains/supporting/dex/dex.module';
import { PayInFactory } from 'src/subdomains/supporting/payin/factories/payin.factory';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { RegisterStrategyRegistry } from 'src/subdomains/supporting/payin/strategies/register/impl/base/register.strategy-registry';
import { LightningStrategy } from 'src/subdomains/supporting/payin/strategies/register/impl/lightning.strategy';
import { SendStrategyRegistry } from 'src/subdomains/supporting/payin/strategies/send/impl/base/send.strategy-registry';
import { BerndController } from './bernd.controller';
import { BerndService } from './bernd.service';

/**
 * ADD BerndModule to PayInModule ...
 * ADD BerndModule to PayOutModule ...
 */

@Module({
  imports: [LightningModule, DexModule],
  controllers: [BerndController],
  providers: [
    BerndService,
    LightningStrategy,
    SendStrategyRegistry,
    RegisterStrategyRegistry,
    PayInFactory,
    PayInRepository,
    AssetService,
    AssetRepository,
  ],
  exports: [BerndService],
})
export class BerndModule {}
