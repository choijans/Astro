import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.test'), override: true });

if (!process.env.DATABASE_URL?.includes('/astro_test')) {
  throw new Error(
    `Refusing to run e2e tests: DATABASE_URL must point at "astro_test", got: ${process.env.DATABASE_URL}`,
  );
}
