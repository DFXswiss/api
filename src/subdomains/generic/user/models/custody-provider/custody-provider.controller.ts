import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CustodyProvider } from './custody-provider.entity';
import { CustodyProviderService } from './custody-provider.service';
import { CustodyProviderDto } from './dto/custody-provider.dto';

@ApiTags('CustodyProvider')
@Controller('CustodyProvider')
@ApiExcludeController()
export class CustodyProviderController {
  constructor(private readonly custodyProviderService: CustodyProviderService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async createCustodyProvider(@Body() dto: CustodyProviderDto): Promise<CustodyProvider> {
    return this.custodyProviderService.createCustodyProvider(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN), UserActiveGuard)
  async updateCustodyProvider(
    @Param('id') id: string,
    @Body() custodyProvider: CustodyProviderDto,
  ): Promise<CustodyProvider> {
    return this.custodyProviderService.updateCustodyProvider(+id, custodyProvider);
  }
}
