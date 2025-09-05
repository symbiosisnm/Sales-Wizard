const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app, sessions, contextParams } = require('../server');

beforeEach(() => {
  for (const key of Object.keys(sessions)) delete sessions[key];
  for (const key of Object.keys(contextParams)) delete contextParams[key];
});

test('saving turns and retrieving transcripts', async () => {
  await request(app)
    .post('/sessions/123/turns')
    .send({ transcription: 'hi', ai_response: 'hello' })
    .expect(201);

  const res = await request(app)
    .get('/sessions/123/transcript')
    .expect(200);
  assert.deepStrictEqual(res.body.transcript, [{ transcription: 'hi', ai_response: 'hello' }]);
});

test('creating/updating context parameters and enforcing source restrictions', async () => {
  await request(app)
    .put('/context/foo')
    .send({ value: 'bar', source: 'user' })
    .expect(200);

  await request(app)
    .put('/context/foo')
    .send({ value: 'baz', source: 'user' })
    .expect(200);

  const res = await request(app)
    .put('/context/foo')
    .send({ value: 'hack', source: 'system' })
    .expect(403);
  assert.strictEqual(res.body.error, 'Source mismatch');

  const final = await request(app)
    .get('/context/foo')
    .expect(200);
  assert.strictEqual(final.body.value, 'baz');
});
