import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { Asset } from './asset.entity';
import { AssetService } from './asset.service';
import { AssetDtoMapper } from './dto/asset-dto.mapper';
import { AssetQueryDto } from './dto/asset-query.dto';
import { AssetDetailDto } from './dto/asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('Asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService, private readonly repoFactory: RepositoryFactory) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: AssetDetailDto, isArray: true })
  async getAllAsset(
    @GetJwt() jwt: JwtPayload | undefined,
    @Query() { blockchains, includePrivate }: AssetQueryDto,
  ): Promise<AssetDetailDto[]> {
    const queryBlockchains = blockchains?.split(',').map((value) => value as Blockchain);

    const specRepo = this.repoFactory.transactionSpecification;
    const specs = await specRepo.find();

    return this.assetService
      .getAllBlockchainAssets(queryBlockchains ?? jwt?.blockchains ?? [], includePrivate === 'true')
      .then((list) =>
        list.map((a) => AssetDtoMapper.toDetailDto(a, specRepo.getSpecFor(specs, a, TransactionDirection.OUT))),
      );
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async updateAsset(@Param('id') id: string, @Body() dto: UpdateAssetDto): Promise<Asset> {
    return this.assetService.updateAsset(+id, dto);
  }
}
