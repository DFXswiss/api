import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerConsent } from './partner-consent.entity';
import { PartnerConsentRepository } from './partner-consent.repository';
import { PartnerConsentService } from './partner-consent.service';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerConsent])],
  providers: [PartnerConsentRepository, PartnerConsentService],
  exports: [PartnerConsentService],
})
export class PartnerConsentModule {}
