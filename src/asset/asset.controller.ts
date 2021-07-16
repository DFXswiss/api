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
import { GetAssetDto } from "./dto/get-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get(':key')
  async getAsset(@Param() asset: any): Promise<any> {
    return this.assetService.getAsset(asset);
  }

  @Get()
  async getAllAsset(): Promise<any> {
    return this.assetService.getAllAsset();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AdminGuard)
  createAsset(@Body() createAssetDto: CreateAssetDto): Promise<any> {
    return this.assetService.createAsset(createAssetDto);
  }

  @Put()
  @UseGuards(AdminGuard)
  @UsePipes(ValidationPipe)
  async updateAssetRoute(@Body() asset: UpdateAssetDto): Promise<any> {
    return this.assetService.updateAsset(asset);
  }
}
