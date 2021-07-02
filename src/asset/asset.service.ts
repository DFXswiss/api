import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { Asset } from './asset.entity';

@Injectable()
export class AssetService {
  async createAsset(user: any): Promise<string> {
    return '1';
  }

  async findAssetByAddress(): Promise<string> {
    return '2';
  }

  async updateAsset(user: any): Promise<string> {
    return '3';
  }

  async findAssetByKey(key:any): Promise<string> {
    return '4';
  }
}
