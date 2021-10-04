import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HttpService } from './services/http.service';
import { ConversionService } from './services/conversion.service';
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

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([AssetRepository, FiatRepository, CountryRepository, LanguageRepository]),
    PassportModule.register({ defaultStrategy: 'jwt', session: true }),
  ],
  controllers: [AssetController, FiatController, CountryController, LanguageController],
  providers: [ConversionService, HttpService, AssetService, FiatService, CountryService, LanguageService],
  exports: [PassportModule, ConversionService, HttpService, AssetService, FiatService, CountryService, LanguageService],
})
export class SharedModule {}
