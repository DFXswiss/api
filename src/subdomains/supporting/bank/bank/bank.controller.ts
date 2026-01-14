import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BankService } from './bank.service';
import { BankDto } from './dto/bank.dto';
import { BankMapper } from './dto/bank.mapper';

@ApiTags('Bank')
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Get()
  @ApiOkResponse({ type: BankDto, isArray: true })
  async getAllBanks(): Promise<BankDto[]> {
    const banks = await this.bankService.getAllBanks();

    return banks.map(BankMapper.toDto);
  }
}
