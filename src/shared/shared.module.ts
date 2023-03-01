import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpService } from './services/http.service';
import { AssetController } from './models/asset/asset.controller';
import { AssetService } from './models/asset/asset.service';
import { AssetRepository } from './models/asset/asset.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FiatController } from './models/fiat/fiat.controller';
import { FiatService } from './models/fiat/fiat.service';
import { FiatRepository } from './models/fiat/fiat.repository';
import { CountryRepository } from './models/country/country.repository';
import { LanguageRepository } from './models/language/language.repository';
import { CountryController } from './models/country/country.controller';
import { LanguageController } from './models/language/language.controller';
import { CountryService } from './models/country/country.service';
import { LanguageService } from './models/language/language.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './auth/jwt.strategy';
import { ScheduleModule } from '@nestjs/schedule';
import { SettingRepository } from './models/setting/setting.repository';
import { SettingService } from './models/setting/setting.service';
import { GetConfig } from 'src/config/config';
import { ConfigModule } from 'src/config/config.module';
import { I18nModule } from 'nestjs-i18n';
import { SettingController } from './models/setting/setting.controller';
import { ApiKeyService } from './services/api-key.service';
import { PaymentInfoService } from './services/payment-info.service';
import { IpLogRepository } from './models/ip-log/ip-log.repository';
import { IpLogService } from './models/ip-log/ip-log.service';
import { GeoLocationModule } from 'src/integration/geolocation/geo-location.module';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    GeoLocationModule,
    TypeOrmModule.forFeature([
      AssetRepository,
      FiatRepository,
      CountryRepository,
      LanguageRepository,
      SettingRepository,
      IpLogRepository,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt', session: true }),
    JwtModule.register(GetConfig().auth.jwt),
    I18nModule.forRoot(GetConfig().i18n),
    ScheduleModule.forRoot(),
  ],
  controllers: [AssetController, FiatController, CountryController, LanguageController, SettingController],
  providers: [
    HttpService,
    AssetService,
    FiatService,
    CountryService,
    LanguageService,
    SettingService,
    JwtStrategy,
    ApiKeyService,
    PaymentInfoService,
    IpLogService,
  ],
  exports: [
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
    ApiKeyService,
    PaymentInfoService,
    IpLogService,
  ],
})
export class SharedModule {}
