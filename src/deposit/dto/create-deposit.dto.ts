import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class CreateDepositDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    address: string;
}