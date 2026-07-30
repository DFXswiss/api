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
    // Endpoint is hit ~10.8×/min (peak 30/min). Fiat and country already use findCached;
    // this was the last uncached DB query per call. Cache sits on the repository layer so that
    // FiatService.updatePrice() → fiatRepo.invalidateCache() still takes effect immediately
    // (same principle as why there is no separate controller-level response cache).
    const specs = await specRepo.findCached('all');
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
