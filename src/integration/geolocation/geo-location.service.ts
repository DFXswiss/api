import { Injectable } from '@nestjs/common';
import GeoIp from 'geoip-lite2';

@Injectable()
export class GeoLocationService {
  async getCountry(ip: string): Promise<string> {
    const geoLocation = GeoIp.lookup(ip);
    return geoLocation?.country;
  }
}
