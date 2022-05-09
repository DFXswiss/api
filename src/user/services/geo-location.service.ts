import { Injectable } from '@nestjs/common';
import GeoIp = require('fast-geoip');

export interface ipInfo {
  range: [number, number];
  country: string;
  region: string;
  eu: '0' | '1';
  timezone: string;
  city: string;
  ll: [number, number];
  metro: number;
  area: number;
}
@Injectable()
export class GeoLocationService {
  async getCountry(ip: string): Promise<ipInfo> {
    return await GeoIp.lookup(ip);
  }
}
