import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { equals, IsBoolean, IsEmail, IsIBAN, IsInt, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length } from "class-validator";

// TODO: Again: Custom decorators for address and signature,...
export class CreateSellDto {
    
    @ApiProperty()
    @IsNotEmpty()
    @IsIBAN()
    iban: string;
    
    @ApiProperty()
    @IsNotEmpty()
    @IsInt()
    fiat: number; // should be an object

}