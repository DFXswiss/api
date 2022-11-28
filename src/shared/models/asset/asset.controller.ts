import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';

@ApiTags('asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  async getAllAsset(@GetJwt() jwt?: JwtPayload, @Query('blockchains') blockchains?: string): Promise<Asset[]> {
    const queryBlockchains = blockchains?.split(',').map((value) => value as Blockchain);
    return this.assetService.getAllAsset(queryBlockchains ?? jwt?.blockchains ?? []);
  }
}
