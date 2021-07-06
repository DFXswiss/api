import { Body, Controller, Get, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { User } from 'src/user/user.entity';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { GetUser } from './get-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // @Get()
  // @UseGuards(UserGuard)
  // async getAuthRoute(): Promise<any> {
  //   return this.authService.findAuthByAddress();
  // }

  @Post('/signup')
  @UsePipes(ValidationPipe)
  signUp(@Body() createUserDto: CreateUserDto): Promise<void> {
    return this.authService.signUp(createUserDto);
  }

  @Post('/signin')
  @UsePipes(ValidationPipe)
  signIn(@Body() authCredentialsDto: AuthCredentialsDto): Promise<{ accessToken: string }> {
    return this.authService.signIn(authCredentialsDto);
  }

  // TODO: For tests, returns user which you can geht via GetUser() decorator.
  @Get('/test')
  @UseGuards(AuthGuard())
  test(@GetUser() user: User) {
    return user;
  }
}
