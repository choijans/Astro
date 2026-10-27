import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChannelsModule } from './channels/channels.module';
import { ClockModule } from './common/clock.module';
import { getRateLimitMax, getRateLimitTtlMs } from './common/rate-limit.config';
import { CommandsModule } from './commands/commands.module';
import { FavouritesModule } from './favourites/favourites.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ClockModule,
    // Registered here (ThrottlerModule is @Global()) so AppThrottlerGuard is
    // resolvable wherever it's applied via @UseGuards, without importing
    // this module again in CommandsModule/FavouritesModule. Not attached as
    // a global APP_GUARD — only the routes that apply it are ever limited.
    ThrottlerModule.forRoot([
      { ttl: getRateLimitTtlMs(), limit: getRateLimitMax() },
    ]),
    ChannelsModule,
    CommandsModule,
    FavouritesModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
