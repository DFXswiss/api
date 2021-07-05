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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from 'src/guards/admin.guard';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get()
  async getAssetRoute(): Promise<any> {
    return this.assetService.findAssetByAddress();
  }

  @Get('key')
  async getAssetByKey(@Param() key: string): Promise<any> {
    return this.assetService.findAssetByKey(key);
  }

  @Post()
  @UsePipes(ValidationPipe)
  createAsset(@Body() createAssetDto: CreateAssetDto): Promise<void> {
    return this.assetService.createAsset(createAssetDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  async updateAssetRoute(@Body() asset: Asset, @Request() req) {
    if (this.assetService.findAssetByAddress() == null) return 'Not exist';
    return this.assetService.updateAsset(asset);
  }
}
