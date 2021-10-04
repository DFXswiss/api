import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/user/user.entity';
import { AssetService } from './asset.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get(':key')
  @ApiBearerAuth()
  @ApiParam({
    name: 'key',
    required: true,
    description:
      'either an integer for the asset id or a string for the asset name',
    schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  })
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAsset(@Param() key: any): Promise<any> {
    return this.assetService.getAsset(key);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllAsset(): Promise<any> {
    return this.assetService.getAllAsset();
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createAsset(@Body() createAssetDto: CreateAssetDto): Promise<any> {
    return this.assetService.createAsset(createAssetDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  @UsePipes(ValidationPipe)
  async updateAssetRoute(@Body() asset: UpdateAssetDto): Promise<any> {
    return this.assetService.updateAsset(asset);
  }
}
