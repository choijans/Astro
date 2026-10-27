import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export type ChannelSortField = 'stbNumber' | 'title' | 'ranking';
export type SortOrder = 'asc' | 'desc';

const SORT_FIELDS: ChannelSortField[] = ['stbNumber', 'title', 'ranking'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];

export class ListChannelsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort: ChannelSortField = 'stbNumber';

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'asc';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 24;
}
