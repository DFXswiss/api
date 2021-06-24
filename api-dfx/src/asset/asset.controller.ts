import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Request,
  ForbiddenException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Get()
  async getAssetRoute(): Promise<any> {
    return this.assetService.findAssetByAddress();
  }

  @Get('key')
  async getAssetByKey(@Param() key: string): Promise<any> {
    return this.assetService.findAssetByKey(key);
  }

  @Post()
  @UseGuards(AdminGuard)
  async createAssetRoute(@Body() asset: Asset, @Request() req) {
    if (this.assetService.findAssetByAddress() != null) return 'Already exist';
    return this.assetService.createAsset(asset);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateAssetRoute(@Body() asset: Asset, @Request() req) {
    if (this.assetService.findAssetByAddress() == null) return 'Not exist';
    return this.assetService.updateAsset(asset);
  }
}
