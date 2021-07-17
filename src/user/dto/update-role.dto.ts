import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsEmail, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, IsInt } from "class-validator";
import { UserRole} from 'src/user/user.entity';

// TODO: Again: Custom decorators for address and signature,...
export class UpdateRoleDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    id: number;

    @ApiPropertyOptional()
    @IsString()
    role: UserRole;
}