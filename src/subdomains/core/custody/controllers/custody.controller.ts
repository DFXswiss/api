import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RealIP } from 'nestjs-real-ip';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateCustodyAccountDto } from '../dto/input/create-custody-account.dto';
import { CreateCustodyActionOrderDto } from '../dto/input/create-custody-action-order.dto';
import { CustodyAuthResponseDto } from '../dto/output/create-custody-account-output.dto';
import { CustodyActionOrderResponseDto } from '../dto/output/create-custody-action-order-output.dto';
import { CustodyService } from '../services/custody-service';

@ApiTags('Custody')
@Controller('custody')
export class CustodyController {
  constructor(private readonly service: CustodyService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ACCOUNT), UserActiveGuard)
  async createCustodyAccount(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyAccountDto,
    @RealIP() ip: string,
  ): Promise<CustodyAuthResponseDto> {
    return this.service.createCustodyAccount(jwt.user, dto, ip);
  }

  @Post('action')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.CUSTODY), UserActiveGuard)
  async createActionOrder(
    @GetJwt() jwt: JwtPayload,
    @Body() dto: CreateCustodyActionOrderDto,
  ): Promise<CustodyActionOrderResponseDto> {
    return this.service.createActionOrder(jwt, dto);
  }

  @Post('action/:id/confirm')
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.CUSTODY), UserActiveGuard)
  async confirmActionOrder(@GetJwt() jwt: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.service.confirmActionOrder(jwt.user, +id);
  }
}
