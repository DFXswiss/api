import {
    Body,
    Controller,
    Get,
    Param,
    Put,
    UseGuards,
    Request,
    ForbiddenException,
    Post,
    UsePipes,
    ValidationPipe,
  
  } from '@nestjs/common';
  import { ApiTags } from '@nestjs/swagger';
  import { RoleGuard } from 'src/guards/role.guard';
  import { Log } from './log.entity';
  import { LogService } from './log.service';
  import { CreateLogDto } from './dto/create-log.dto';
  import { UpdateLogDto } from "./dto/update-log.dto";
  import { AuthGuard } from '@nestjs/passport';
  import { UserRole } from 'src/user/user.entity';
  
  @ApiTags('log')
  @Controller('log')
  export class LogController {
    constructor(private readonly logService: LogService) {}
  
    @Get(':key')
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    @UsePipes(ValidationPipe)
    async getLog(@Param() log: any): Promise<any> {
      return this.logService.getLog(log);
    }
  
    @Get()
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.USER))
    async getAllLog(): Promise<any> {
      return this.logService.getAllLog();
    }
  
    @Post()
    @UsePipes(ValidationPipe)
    @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    createLog(@Body() createLogDto: CreateLogDto): Promise<any> {
      return this.logService.createLog(createLogDto);
    }
  
    // @Put()
    // @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
    // @UsePipes(ValidationPipe)
    // async updateDepositRoute(@Body() deposit: UpdateLogDto): Promise<any> {
    //   return this.depositService.updateDeposit(deposit);
    // }
  }
  