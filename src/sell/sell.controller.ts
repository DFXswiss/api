import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { SellService } from './sell.service';
import { CreateSellDto } from './dto/create-sell.dto';
import { UpdateSellDto } from './dto/update-sell.dto';
import { User, UserRole } from 'src/user/user.entity';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from 'src/auth/get-user.decorator';

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
  async getSellRoute(@GetUser() user: User, @Param() id: any): Promise<any> {
    return this.sellService.getSell(id, user.address);
  }

  @Get()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async getAllSellRoute(@GetUser() user: User): Promise<any> {
    return this.sellService.getAllSell(user.address);
  }

  @Post()
  @ApiBearerAuth()
  @UsePipes(ValidationPipe)
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  createSell(
    @GetUser() user: User,
    @Body() createSellDto: CreateSellDto,
  ): Promise<any> {
    createSellDto.user = user;
    return this.sellService.createSell(createSellDto);
  }

  @Put()
  @ApiBearerAuth()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
  async updateSellRoute(
    @GetUser() user: User,
    @Body() updateSellDto: UpdateSellDto,
  ): Promise<any> {
    updateSellDto.address = user.address;
    return this.sellService.updateSell(updateSellDto);
  }
}
