import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Prisma } from '../generated/prisma/client';
import { AstroSearchLinearResponse } from '../src/astro/astro.types';
import { configureApp } from '../src/configure-app';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const fixturePath = join(__dirname, 'fixtures/astro-response.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as AstroSearchLinearResponse;
const fixtureChannels = fixture.response.channels.data;
const TOTAL_CHANNELS = fixtureChannels.length;

/**
 * Postgres's default locale collation (used for `ORDER BY title`) doesn't match
 * JS's `<`/`>` or `localeCompare` string ordering (different punctuation/case
 * handling). Rather than re-implement that collation in JS, ask Postgres
 * itself whether the exact sequence the API returned is sorted.
 */
async function isSortedAccordingToDb(
  prisma: PrismaService,
  values: Array<string | number>,
  order: 'asc' | 'desc',
): Promise<boolean> {
  if (values.length < 2) return true;

  const comparator = Prisma.raw(order === 'asc' ? '<=' : '>=');
  const isNumeric = typeof values[0] === 'number';
  const castType = Prisma.raw(isNumeric ? 'double precision[]' : 'text[]');

  const rows = await prisma.$queryRaw<{ sorted: boolean | null }[]>`
    SELECT bool_and(v ${comparator} next_v) as sorted
    FROM (
      SELECT v, lead(v) OVER () as next_v
      FROM unnest(${values}::${castType}) as v
    ) pairs
    WHERE next_v IS NOT NULL
  `;

  return rows[0]?.sorted ?? true;
}

describe('Channels (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /channels', () => {
    it('returns a paginated list that excludes the schedule', async () => {
      const res = await request(app.getHttpServer()).get('/channels').query({ limit: 5 }).expect(200);

      expect(res.body).toMatchObject({ page: 1, limit: 5, total: TOTAL_CHANNELS });
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data[0]).not.toHaveProperty('schedule');
    });

    it('search "100" finds the channel with number 100', async () => {
      const target = fixtureChannels.find((c) => c.stbNumber === '100');
      expect(target).toBeDefined();

      const res = await request(app.getHttpServer()).get('/channels').query({ q: '100' }).expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe(target!.id);
    });

    it('a numeric q larger than Postgres integer range returns 200 with an empty result, not a 500', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: '99999999999999' })
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.data).toEqual([]);
    });

    it('rejects q longer than 100 characters with 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels')
        .query({ q: 'a'.repeat(101) })
        .expect(400);

      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });

    it('title search is case-insensitive', async () => {
      const sample = fixtureChannels[0];
      const upper = sample.title.toUpperCase();

      const res = await request(app.getHttpServer()).get('/channels').query({ q: upper }).expect(200);

      expect(res.body.data.some((c: { id: number }) => c.id === sample.id)).toBe(true);
    });

    it.each(['stbNumber', 'title', 'ranking'] as const)(
      'sorts ascending and descending by %s',
      async (sort) => {
        const asc = await request(app.getHttpServer())
          .get('/channels')
          .query({ sort, order: 'asc', limit: 100 })
          .expect(200);
        const desc = await request(app.getHttpServer())
          .get('/channels')
          .query({ sort, order: 'desc', limit: 100 })
          .expect(200);

        const ascValues = asc.body.data.map((c: Record<string, string | number>) => c[sort]);
        const descValues = desc.body.data.map((c: Record<string, string | number>) => c[sort]);

        expect(await isSortedAccordingToDb(prisma, ascValues, 'asc')).toBe(true);
        expect(await isSortedAccordingToDb(prisma, descValues, 'desc')).toBe(true);
      },
    );

    it('paging through every page of ranking-sorted results returns every channel exactly once', async () => {
      const limit = 24;
      const seenIds = new Set<number>();
      let page = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        const res = await request(app.getHttpServer())
          .get('/channels')
          .query({ sort: 'ranking', order: 'asc', page, limit })
          .expect(200);

        for (const item of res.body.data as Array<{ id: number }>) {
          expect(seenIds.has(item.id)).toBe(false);
          seenIds.add(item.id);
        }

        hasNextPage = res.body.hasNextPage;
        page += 1;
      }

      expect(seenIds.size).toBe(TOTAL_CHANNELS);
    });

    it('combines category, language and genre filters with each other (AND)', async () => {
      const sample = fixtureChannels[0];
      const res = await request(app.getHttpServer())
        .get('/channels')
        .query({
          category: sample.category,
          language: sample.languageKey[0],
          genre: sample.genreKey[0],
          limit: 100,
        })
        .expect(200);

      expect(res.body.total).toBeGreaterThan(0);
      for (const item of res.body.data as Array<{ category: string; languages: string[]; genres: string[] }>) {
        expect(item.category).toBe(sample.category);
        expect(item.languages).toContain(sample.languageKey[0]);
        expect(item.genres).toContain(sample.genreKey[0]);
      }
    });

    it.each([
      ['a bad sort field', { sort: 'bogus' }],
      ['limit 0', { limit: 0 }],
      ['limit 101', { limit: 101 }],
      ['page -1', { page: -1 }],
    ])('rejects %s with 400', async (_label, query) => {
      const res = await request(app.getHttpServer()).get('/channels').query(query).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(res.body).toHaveProperty('message');
    });
  });

  describe('GET /channels/filters', () => {
    it('returns distinct categories, languages and genres', async () => {
      const res = await request(app.getHttpServer()).get('/channels/filters').expect(200);

      const expectedCategories = [...new Set(fixtureChannels.map((c) => c.category))].sort();
      expect(res.body.categories).toEqual(expectedCategories);
    });
  });

  describe('GET /channels/:id', () => {
    it('returns the full channel, including schedule and scheduleUpdatedAt', async () => {
      const sample = fixtureChannels[0];
      const res = await request(app.getHttpServer()).get(`/channels/${sample.id}`).expect(200);

      expect(res.body).toHaveProperty('schedule');
      expect(res.body).toHaveProperty('scheduleUpdatedAt');
    });

    it('returns 404 for an unknown id', async () => {
      const res = await request(app.getHttpServer()).get('/channels/999999').expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });

    it('returns 400 for a non-integer id', async () => {
      const res = await request(app.getHttpServer()).get('/channels/abc').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });
  });

  describe('CORS', () => {
    it('gets no Access-Control-Allow-Origin header from a disallowed origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels/filters')
        .set('Origin', 'http://evil.example.com')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('gets the Access-Control-Allow-Origin header from an allowed origin', async () => {
      const allowedOrigin = process.env.CORS_ORIGIN!.split(',')[0].trim();

      const res = await request(app.getHttpServer())
        .get('/channels/filters')
        .set('Origin', allowedOrigin)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    });
  });
});
