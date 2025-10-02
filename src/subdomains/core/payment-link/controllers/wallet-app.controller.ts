import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { WalletAppDto, WalletAppId } from '../dto/wallet-app.dto';
import { WalletAppService } from '../services/wallet-app.service';

@ApiTags('Wallet Apps')
@Controller('walletApps')
export class WalletAppController {
  constructor(private readonly walletAppService: WalletAppService) {}

  @Get()
  @ApiOkResponse({ type: WalletAppDto, isArray: true })
  @ApiQuery({ name: 'method', description: 'Filter by supported method', required: false })
  getAll(@Query('method') method?: string): WalletAppDto[] {
    if (method) {
      return this.walletAppService.getBySupportedMethod(method);
    }
    return this.walletAppService.getAll();
  }

  @Get('recommended')
  @ApiOkResponse({ type: WalletAppDto, isArray: true })
  getRecommended(): WalletAppDto[] {
    return this.walletAppService.getRecommended();
  }

  @Get(':id')
  @ApiOkResponse({ type: WalletAppDto })
  getById(@Param('id') id: WalletAppId): WalletAppDto {
    return this.walletAppService.getById(id);
  }
}
