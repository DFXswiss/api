import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { CountryService } from '../country/country.service';
import { FiatDtoMapper } from './dto/fiat-dto.mapper';
import { FiatDetailDto } from './dto/fiat.dto';
import { FiatService } from './fiat.service';

@ApiTags('Fiat')
@Controller('fiat')
export class FiatController {
  constructor(
    private readonly fiatService: FiatService,
    private readonly repoFactory: RepositoryFactory,
    private readonly countryService: CountryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: FiatDetailDto, isArray: true })
  async getAllFiat(): Promise<FiatDetailDto[]> {
    const specRepo = this.repoFactory.transactionSpecification;
    const specs = await specRepo.find();
    const countries = await this.countryService.getAllCountry();

    return this.fiatService
      .getAllFiat()
      .then((list) =>
        list.map((f) =>
          FiatDtoMapper.toDetailDto(f, specRepo.getSpecFor(specs, f, TransactionDirection.IN), countries),
        ),
      );
  }
}
