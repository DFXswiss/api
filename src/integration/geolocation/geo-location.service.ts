import { Injectable } from '@nestjs/common';
import GeoIp from 'fast-geoip';

@Injectable()
export class GeoLocationService {
  async getCountry(ip: string): Promise<string> {
    const geoLocation = await GeoIp.lookup(ip);
    return geoLocation?.country;
  }
}
