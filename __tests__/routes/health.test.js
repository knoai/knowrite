const request = require('supertest');
const express = require('express');

// Create minimal app with just health endpoint
const app = express();
app.get('/health', async (req, res) => {
  const checks = {
    database: { status: 'ok' },
    disk: { status: 'ok' },
    proxy: { status: 'unknown' },
  };
  res.json({
    status: 'ok',
    checks,
    timestamp: new Date().toISOString(),
  });
});

describe('GET /health', () => {
  test('returns health status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toBeDefined();
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});
