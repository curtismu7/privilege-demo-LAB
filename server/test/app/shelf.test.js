import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp } from './helpers.js';

// Regression: the header "Shelf" button reads GET /api/shelf. It used to sit after the /api 404 handler and
// inside the web-build check, so it never answered. It must answer with no web build present.
describe('GET /api/shelf', () => {
  it('returns SHELF_URL (trailing slash trimmed) without a web build; POST is not 200', async () => {
    const prev = process.env.SHELF_URL;
    process.env.SHELF_URL = 'https://shelf.example:8443/';
    try {
      const { app } = makeApp();
      const r = await request(app).get('/api/shelf');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ shelfUrl: 'https://shelf.example:8443' });
      const p = await request(app).post('/api/shelf').send({});
      expect(p.status).not.toBe(200);
    } finally {
      if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
    }
  });
});
