import { Injectable } from '@nestjs/common';
import { CHANNEL_LIST_SELECT } from '../channels/channels.repository';
import { PrismaService } from '../prisma/prisma.service';

/** The only class that touches Prisma for reading favourites (writes go through CommandsService). */
@Injectable()
export class FavouritesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listFavourites(userId: string) {
    const rows = await this.prisma.favourite.findMany({
      where: { userId },
      // Newest first; channelId breaks ties when two favourites share a
      // createdAt timestamp, so the order is always deterministic.
      orderBy: [{ createdAt: 'desc' }, { channelId: 'asc' }],
      include: { channel: { select: CHANNEL_LIST_SELECT } },
    });
    return rows.map((row) => row.channel);
  }
}
