import { Body, Controller, Get, Param, Put, UseGuards, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { AuthGuard } from '@nestjs/passport';
import { GetJwt } from 'src/shared/auth/get-jwt.decorator';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';

@ApiTags('sell')
@Controller('sell')
export class SellController {
  constructor(private readonly sellService: SellService) {}

  @Get(':id')
  @ApiBearerAuth()
  @ApiParam({
    name: 'id',
    required: true,
    description: 'integer for the sell id',
    schema: { type: 'integer' },
  })
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getSellRoute(@GetJwt() jwt: JwtPayload, @Param() id: any): Promise<any> {
    return this.sellService.getSell(id, jwt.address);
  }

  @Get()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllSellRoute(@GetJwt() jwt: JwtPayload): Promise<any> {
    return this.sellService.getAllSell(jwt.address);
  }

  @Post()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(@GetJwt() jwt: JwtPayload, @Body() createSellDto: CreateSellDto): Promise<any> {
    return this.sellService.createSell(jwt.id, createSellDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSellRoute(@GetJwt() jwt: JwtPayload, @Body() updateSellDto: UpdateSellDto): Promise<any> {
    updateSellDto.address = jwt.address;
    return this.sellService.updateSell(updateSellDto);
  }
}
