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
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { request } from 'express';
import { GetUser } from 'src/auth/get-user.decorator';
import { RoleGuard } from 'src/guards/role.guard';
import { UserRole } from 'src/user/user.entity';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from "./dto/update-asset.dto";

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get(':key')
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAsset(@Param() asset: any): Promise<any> {
    
    return this.assetService.getAsset(asset);
  }

  @Get()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllAsset(): Promise<any> {
    return this.assetService.getAllAsset();
  }

  @Post()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createAsset(@Body() createAssetDto: CreateAssetDto): Promise<any> {
    return this.assetService.createAsset(createAssetDto);
  }

  @Put()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateAssetRoute(@Body() asset: UpdateAssetDto): Promise<any> {
    return this.assetService.updateAsset(asset);
  }
}
