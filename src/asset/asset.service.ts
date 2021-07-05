import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager, InjectRepository } from '@nestjs/typeorm';
import { Asset } from 'src/asset/asset.entity';
import { AssetRepository } from 'src/asset/asset.repository';
import { CreateAssetDto } from 'src/asset/dto/create-asset.dto';
import { UserRepository } from 'src/user/user.repository';

@Injectable()
export class AssetService {
  constructor(private assetRepository: AssetRepository, private userRepository: UserRepository) {}
  
  async createAsset(createAssetDto: CreateAssetDto): Promise<void>{
    this.assetRepository.createAsset(createAssetDto);
  }

  async findAssetByAddress(): Promise<Asset> {
    return this.assetRepository.findOne({"id": 0});
  }

  async updateAsset(user: any): Promise<string> {
    return '3';
  }

  async findAssetByKey(key:any): Promise<string> {
    return '4';
  }
}
