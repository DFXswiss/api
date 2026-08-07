import { Injectable } from '@nestjs/common';
import GeoIp from 'geoip-lite2';

@Injectable()
export class GeoLocationService {
  getCountry(ip: string): string {
    const geoLocation = GeoIp.lookup(ip);

    // Some IPv6 ranges have a record that carries no country, which arrives as an empty string.
    // That is the same "unknown" as having no record at all, so report it the same way — otherwise
    // ip_log.country holds two different values for one state, empty here and null there.
    return geoLocation?.country || undefined;
  }
}
