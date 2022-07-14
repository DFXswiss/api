import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BuyFiatService } from './buy-fiat.service';

@ApiTags('buyFiat')
@Controller('buyFiat')
export class BuyFiatController {
  constructor(private readonly buyFiatService: BuyFiatService) {}
}
