import { Module } from '@nestjs/common';
import { SharedModule } from 'src/shared/shared.module';
import { BuyCryptoModule } from 'src/subdomains/core/buy-crypto/buy-crypto.module';
import { SellCryptoModule } from 'src/subdomains/core/sell-crypto/sell-crypto.module';
import { PayInModule } from 'src/subdomains/supporting/payin/payin.module';
import { UserModule } from '../user/user.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [SharedModule, UserModule, BuyCryptoModule, SellCryptoModule, PayInModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [],
})
export class SupportModule {}
