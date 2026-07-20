import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class SyncBranchInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  drugIds!: string[];
}
