import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UpdateRouteDto } from './dto/update-route.dto';
import { Route } from './route.entity';
import { RouteService } from './route.service';

@ApiTags('route')
@Controller('route')
@ApiExcludeController()
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Put(':id')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async updateRoute(@Param('id') id: string, @Body() dto: UpdateRouteDto): Promise<Route> {
    return this.routeService.updateRoute(+id, dto);
  }
}
