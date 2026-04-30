import { Module } from '@nestjs/common';
import { GeoLocationService } from './geo-location.service';

@Module({
  imports: [],
  controllers: [],
  providers: [GeoLocationService],
  exports: [GeoLocationService],
})
export class GeoLocationModule {}
