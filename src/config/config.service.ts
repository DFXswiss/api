import { Injectable } from '@nestjs/common';
import { Config, GetConfig } from './config';

@Injectable()
export class ConfigService {
  constructor() {
    Object.assign(Config, GetConfig());
  }
}
