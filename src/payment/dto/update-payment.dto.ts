import { ApiProperty,  } from "@nestjs/swagger";
import {   IsInt, IsOptional,  IsBoolean  } from "class-validator";

export class UpdatePaymentDto {

    @ApiProperty()
    @IsInt()
    id: number;

    @ApiProperty()
    @IsOptional()
    @IsBoolean()
    processed: boolean

}