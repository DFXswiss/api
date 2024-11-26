import { Body, Controller, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { ServiceProviderDto } from './dto/service-provider.dto';
import { ServiceProvider } from './service-provider.entity';
import { ServiceProviderService } from './service-provider.service';

@ApiTags('ServiceProvider')
@Controller('ServiceProvider')
@ApiExcludeController()
export class ServiceProviderController {
  constructor(private readonly serviceProviderService: ServiceProviderService) {}

  @Post()
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async createServiceProvider(@Body() dto: ServiceProviderDto): Promise<ServiceProvider> {
    return this.serviceProviderService.createServiceProvider(dto);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateServiceProvider(
    @Param('id') id: string,
    @Body() serviceProvider: ServiceProviderDto,
  ): Promise<ServiceProvider> {
    return this.serviceProviderService.updateServiceProvider(+id, serviceProvider);
  }
}
