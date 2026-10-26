import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelFilters } from './channels.types';
import { ChannelSortField, SortOrder } from './dto/list-channels-query.dto';

// Exported so FavouritesRepository fetches the exact same shape the channel
// list does, with no drift risk. Includes `schedule` so the service layer can
// compute now/next from it — toChannelListItem() strips it before responding.
export const CHANNEL_LIST_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  stbNumber: true,
  imageUrl: true,
  category: true,
  genres: true,
  languages: true,
  rangeKey: true,
  ranking: true,
  schedule: true,
  scheduleUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Postgres's `integer` type (used for stbNumber) caps at 2147483647; a numeric
// q outside this range can never match a real channel, so it's treated as
// non-numeric rather than passed to Postgres, which would reject it and 500.
const PG_INTEGER_MAX = 2147483647;
const PG_INTEGER_MIN = -2147483648;

export interface FindManyParams {
  q?: string;
  sort: ChannelSortField;
  order: SortOrder;
  category?: string;
  language?: string;
  genre?: string;
  page: number;
  limit: number;
}

/** The only class in this module that talks to Prisma. */
@Injectable()
export class ChannelsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(params: FindManyParams) {
    const where = this.buildWhere(params);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.channel.findMany({
        where,
        orderBy: [{ [params.sort]: params.order }, { id: 'asc' }],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: CHANNEL_LIST_SELECT,
      }),
      this.prisma.channel.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: number) {
    return this.prisma.channel.findUnique({ where: { id } });
  }

  async getFilters(): Promise<ChannelFilters> {
    const rows = await this.prisma.channel.findMany({
      select: { category: true, languages: true, genres: true },
    });

    const categories = new Set<string>();
    const languages = new Set<string>();
    const genres = new Set<string>();

    for (const row of rows) {
      categories.add(row.category);
      row.languages.forEach((language) => languages.add(language));
      row.genres.forEach((genre) => genres.add(genre));
    }

    return {
      categories: [...categories].sort(),
      languages: [...languages].sort(),
      genres: [...genres].sort(),
    };
  }

  private buildWhere(params: FindManyParams): Prisma.ChannelWhereInput {
    const where: Prisma.ChannelWhereInput = {};

    if (params.q) {
      const trimmed = params.q.trim();
      const asNumber = Number(trimmed);
      const isNumeric =
        trimmed !== '' &&
        Number.isInteger(asNumber) &&
        asNumber >= PG_INTEGER_MIN &&
        asNumber <= PG_INTEGER_MAX;

      where.OR = [
        { title: { contains: trimmed, mode: 'insensitive' } },
        ...(isNumeric ? [{ stbNumber: asNumber }] : []),
      ];
    }

    if (params.category) {
      where.category = params.category;
    }
    if (params.language) {
      where.languages = { has: params.language };
    }
    if (params.genre) {
      where.genres = { has: params.genre };
    }

    return where;
  }
}
