import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { FiatDtoMapper } from './dto/fiat-dto.mapper';
import { FiatDetailDto } from './dto/fiat.dto';
import { FiatService } from './fiat.service';

@ApiTags('Fiat')
@Controller('fiat')
export class FiatController {
  constructor(private readonly fiatService: FiatService, private readonly repoFactory: RepositoryFactory) {}

  @Get()
  @ApiOkResponse({ type: FiatDetailDto, isArray: true })
  async getAllFiat(): Promise<FiatDetailDto[]> {
    const specRepo = this.repoFactory.transactionSpecification;
    const specs = await specRepo.find();

    return this.fiatService
      .getAllFiat()
      .then((list) =>
        list.map((f) => FiatDtoMapper.toDetailDto(f, specRepo.getSpecFor(specs, f, TransactionDirection.IN))),
      );
  }
}
