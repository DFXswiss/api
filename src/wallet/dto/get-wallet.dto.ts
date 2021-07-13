import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class GetWalletDto {

    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    @IsOptional()
    id: number;

    @ApiProperty()
    @IsNotEmpty()
    @Length(34,34)
    @IsString()
    @IsOptional()
    address: string;

}