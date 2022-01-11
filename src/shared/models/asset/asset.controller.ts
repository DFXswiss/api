import { Body, Controller, Get, Param, Put, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiParam, ApiTags } from '@nestjs/swagger';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
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
    description: 'either an integer for the asset id or a string for the asset name',
    schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
  })
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAsset(@Param() key: any, @GetJwt() jwt: JwtPayload): Promise<any> {
    const asset = await this.assetService.getAsset(key);
    if (jwt.role !== UserRole.ADMIN) delete asset['sellCommand'];
    return asset;
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllAsset(@GetJwt() jwt: JwtPayload): Promise<any> {
    const asset = await this.assetService.getAllAsset();
    if (jwt.role !== UserRole.ADMIN) {
      for (const a of asset) {
        delete a['sellCommand'];
      }
    }
    return asset;
  }

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  createAsset(@Body() createAssetDto: CreateAssetDto): Promise<any> {
    return this.assetService.createAsset(createAssetDto);
  }

  @Put()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateAssetRoute(@Body() asset: UpdateAssetDto): Promise<any> {
    return this.assetService.updateAsset(asset);
  }
}
