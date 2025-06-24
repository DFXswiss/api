import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { I18nModule } from 'nestjs-i18n';
import { GetConfig } from 'src/config/config';
import { ConfigModule } from 'src/config/config.module';
import { GeoLocationModule } from 'src/integration/geolocation/geo-location.module';
import { JwtStrategy } from './auth/jwt.strategy';
import { AssetController } from './models/asset/asset.controller';
import { Asset } from './models/asset/asset.entity';
import { AssetRepository } from './models/asset/asset.repository';
import { AssetService } from './models/asset/asset.service';
import { CountryController } from './models/country/country.controller';
import { Country } from './models/country/country.entity';
import { CountryRepository } from './models/country/country.repository';
import { CountryService } from './models/country/country.service';
import { FiatController } from './models/fiat/fiat.controller';
import { Fiat } from './models/fiat/fiat.entity';
import { FiatRepository } from './models/fiat/fiat.repository';
import { FiatService } from './models/fiat/fiat.service';
import { IpLog } from './models/ip-log/ip-log.entity';
import { IpLogRepository } from './models/ip-log/ip-log.repository';
import { IpLogService } from './models/ip-log/ip-log.service';
import { LanguageController } from './models/language/language.controller';
import { Language } from './models/language/language.entity';
import { LanguageRepository } from './models/language/language.repository';
import { LanguageService } from './models/language/language.service';
import { SettingController } from './models/setting/setting.controller';
import { Setting } from './models/setting/setting.entity';
import { SettingRepository } from './models/setting/setting.repository';
import { SettingService } from './models/setting/setting.service';
import { RepositoryFactory } from './repositories/repository.factory';
import { DfxCronService } from './services/dfx-cron.service';
import { DfxLoggerService } from './services/dfx-logger.service';
import { HttpService } from './services/http.service';
import { PaymentInfoService } from './services/payment-info.service';
import { ProcessService } from './services/process.service';

@Module({
  imports: [
    DiscoveryModule,
    HttpModule,
    ConfigModule,
    GeoLocationModule,
    TypeOrmModule.forFeature([Asset, Fiat, Country, Language, Setting, IpLog]),
    PassportModule.register({ defaultStrategy: 'jwt', session: true }),
    JwtModule.register(GetConfig().auth.jwt),
    I18nModule.forRoot(GetConfig().i18n),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(),
  ],
  controllers: [AssetController, FiatController, CountryController, LanguageController, SettingController],
  providers: [
    RepositoryFactory,
    AssetRepository,
    FiatRepository,
    CountryRepository,
    LanguageRepository,
    SettingRepository,
    IpLogRepository,
    HttpService,
    AssetService,
    FiatService,
    CountryService,
    LanguageService,
    SettingService,
    JwtStrategy,
    PaymentInfoService,
    IpLogService,
    ProcessService,
    DfxCronService,
    DfxLoggerService,
  ],
  exports: [
    RepositoryFactory,
    PassportModule,
    JwtModule,
    ScheduleModule,
    GeoLocationModule,
    HttpService,
    AssetService,
    FiatService,
    CountryService,
    LanguageService,
    SettingService,
    PaymentInfoService,
    IpLogService,
    ProcessService,
    DfxLoggerService,
  ],
})
export class SharedModule {}
