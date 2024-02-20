import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { AssetService } from './asset.service';
import { AssetDtoMapper } from './dto/asset-dto.mapper';
import { AssetQueryDto } from './dto/asset-query.dto';
import { AssetDetailDto } from './dto/asset.dto';

@ApiTags('Asset')
@Controller('asset')
export class AssetController {
  constructor(private assetService: AssetService, private readonly repoFactory: RepositoryFactory) {}

  @Get()
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ type: AssetDetailDto, isArray: true })
  async getAllAsset(@Query() { blockchains }: AssetQueryDto, @GetJwt() jwt?: JwtPayload): Promise<AssetDetailDto[]> {
    const queryBlockchains = blockchains?.split(',').map((value) => value as Blockchain);

    const specRepo = this.repoFactory.transactionSpecification;
    const specs = await specRepo.find();

    return this.assetService
      .getAllAsset(queryBlockchains ?? jwt?.blockchains ?? [])
      .then((list) =>
        list.map((a) => AssetDtoMapper.toDetailDto(a, specRepo.getSpecFor(specs, a, TransactionDirection.OUT))),
      );
  }
}
