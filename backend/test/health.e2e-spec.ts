import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { HealthService } from '../src/health/health.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health returns 200 with the real database and Redis both up', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('GET /health returns 503 naming the down check, without stopping any real service (the provider is overridden instead)', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HealthService)
      .useValue({
        check: () => Promise.resolve({ database: 'down', redis: 'up' }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'up' },
    });
  });

  it('never includes error details, hostnames or connection strings in the response body', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HealthService)
      .useValue({
        check: () => Promise.resolve({ database: 'down', redis: 'down' }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const res = await request(app.getHttpServer()).get('/health').expect(503);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/postgresql:\/\//i);
    expect(serialized).not.toMatch(/redis:\/\//i);
    expect(Object.keys(res.body)).toEqual(['status', 'checks']);
  });
});
