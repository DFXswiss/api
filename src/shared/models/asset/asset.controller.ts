import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { AssetService } from './asset.service';
import { AssetDtoMapper } from './dto/asset-dto.mapper';
import { AssetQueryDto } from './dto/asset-query.dto';
import { AssetDto } from './dto/asset.dto';

@ApiTags('Asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: AssetDto, isArray: true })
  async getAllAsset(@Query() { blockchains }: AssetQueryDto, @GetJwt() jwt?: JwtPayload): Promise<AssetDto[]> {
    const queryBlockchains = blockchains?.split(',').map((value) => value as Blockchain);
    return this.assetService.getAllAsset(queryBlockchains ?? jwt?.blockchains ?? []).then(AssetDtoMapper.entitiesToDto);
  }
}
