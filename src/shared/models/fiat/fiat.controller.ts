import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { TransactionDirection } from 'src/subdomains/supporting/payment/entities/transaction-specification.entity';
import { CountryService } from '../country/country.service';
import { FiatDtoMapper } from './dto/fiat-dto.mapper';
import { FiatDetailDto } from './dto/fiat.dto';
import { FiatService } from './fiat.service';

@ApiTags('Fiat')
@Controller('fiat')
export class FiatController {
  // EVERY_5_MINUTES matches CachedRepository's default list TTL, including the underlying
  // fiat and country lists this endpoint uses. A longer TTL here would keep the response
  // fresher than its own building blocks.
  private readonly cache = new AsyncCache<FiatDetailDto[]>(CacheItemResetPeriod.EVERY_5_MINUTES);

  constructor(
    private readonly fiatService: FiatService,
    private readonly repoFactory: RepositoryFactory,
    private readonly countryService: CountryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: FiatDetailDto, isArray: true })
  async getAllFiat(): Promise<FiatDetailDto[]> {
    // Constant key: the endpoint takes no parameters and is not user-specific, so every caller
    // gets the same list. Concurrent misses share one build — AsyncCache awaits the in-flight
    // update instead of starting a second one.
    return this.cache.get('all', () => this.buildFiatList());
  }

  private async buildFiatList(): Promise<FiatDetailDto[]> {
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
