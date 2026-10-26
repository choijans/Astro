import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Shared by main.ts (bootstrap) and the e2e suite, so both run identical config. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
  app.enableCors({
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // Requests with no Origin header (curl, server-to-server) aren't subject
      // to CORS and are always allowed through.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
