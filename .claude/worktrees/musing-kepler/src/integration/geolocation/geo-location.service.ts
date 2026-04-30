import { Injectable } from '@nestjs/common';
import GeoIp from 'geoip-lite2';

@Injectable()
export class GeoLocationService {
  getCountry(ip: string): string {
    const geoLocation = GeoIp.lookup(ip);
    return geoLocation?.country;
  }
}
