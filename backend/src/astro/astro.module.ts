import { Module } from '@nestjs/common';
import { HttpAstroClient } from './astro-client';
import { ASTRO_CLIENT } from './astro-client.interface';
import { CachedAstroClient } from './cached-astro-client';

// First NestJS-DI registration of ASTRO_CLIENT: run-sync.ts and the seed
// script construct HttpAstroClient/FixtureAstroClient by hand and never go
// through this module, since they want the uncached client.
@Module({
  providers: [
    { provide: ASTRO_CLIENT, useClass: HttpAstroClient },
    CachedAstroClient,
  ],
  exports: [CachedAstroClient],
})
export class AstroModule {}
