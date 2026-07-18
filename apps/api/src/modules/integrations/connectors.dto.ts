import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One Yeastar P570 call event (integrations spec J1). */
export class YeastarEventDto {
  @IsEmail()
  agentEmail: string;

  @IsIn(['in', 'out'])
  direction: 'in' | 'out';

  @IsBoolean()
  answered: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  queue?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  talkSeconds?: number;

  @IsOptional()
  @IsDateString()
  at?: string;
}

export class YeastarEventsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => YeastarEventDto)
  events: YeastarEventDto[];
}
