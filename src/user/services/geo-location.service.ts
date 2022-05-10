import { Injectable } from '@nestjs/common';
import GeoIp = require('fast-geoip');

@Injectable()
export class GeoLocationService {
  async getCountry(ip: string): Promise<string> {
    const geoLocation = await GeoIp.lookup(ip);
    return geoLocation?.country;
  }
}
