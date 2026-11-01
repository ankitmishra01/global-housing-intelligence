import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIso3, clampDelta, pctChange, windowStart, retryAfterSeconds, clientIp, escapeXml, rfc822, rss } from '../src/lib/api-helpers.ts';

test('parseIso3 accepts three letters in any case, rejects the rest', () => {
  assert.equal(parseIso3('can'), 'CAN');
  assert.equal(parseIso3(' Gbr '), 'GBR');
  for (const bad of ['CA', 'CANA', 'C4N', '', null, 12]) assert.equal(parseIso3(bad), null);
});

test('clampDelta bounds the rate move and zeroes non-finite input', () => {
  assert.equal(clampDelta(7), 5);
  assert.equal(clampDelta(-9), -5);
  assert.equal(clampDelta(1.25), 1.25);
  assert.equal(clampDelta(NaN), 0);
});

test('pctChange converts an origin-100 index to a rounded % change', () => {
  assert.equal(pctChange(112.345), 12.3);
  assert.equal(pctChange(97.5), -2.5);
  assert.equal(pctChange(null), null);
});

test('fixed rate-limit windows and Retry-After', () => {
  const w = 600;
  assert.equal(windowStart(1_000_000_000_000, w), Math.floor(1_000_000_000_000 / 600_000) * 600_000);
  const start = windowStart(1_000_000_000_000, w);
  assert.equal(retryAfterSeconds(start, w), 600);
  assert.equal(retryAfterSeconds(start + 599_500, w), 1);
  assert.equal(windowStart(start + 599_999, w), start);
  assert.equal(windowStart(start + 600_000, w), start + 600_000);
});

test('clientIp takes the first forwarded address', () => {
  const h = m => ({ get: k => m[k] ?? null });
  assert.equal(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assert.equal(clientIp(h({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
  assert.equal(clientIp(h({})), 'unknown');
});

test('escapeXml escapes markup and strips control characters', () => {
  assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>\u0001`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
});

test('rfc822 handles dates and timestamps', () => {
  assert.equal(rfc822('2026-11-01'), 'Sun, 01 Nov 2026 06:30:00 GMT');
  assert.equal(rfc822('2026-11-01T02:32:52.425Z'), 'Sun, 01 Nov 2026 02:32:52 GMT');
});

test('rss builds a valid channel with items newest first', () => {
  const xml = rss({ title: 'T & co', link: 'https://x.test', description: 'd', selfUrl: 'https://x.test/feed.xml', items: [
    { title: 'old', link: 'https://x.test/a', guid: 'a', date: '2026-10-01' },
    { title: 'new <b>', link: 'https://x.test/b', guid: 'b', date: '2026-11-01', category: 'rate_change', description: 'x > y' },
  ] });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(xml.indexOf('new &lt;b&gt;') < xml.indexOf('<title>old</title>'));
  assert.match(xml, /<title>T &amp; co<\/title>/);
  assert.match(xml, /<atom:link href="https:\/\/x.test\/feed.xml" rel="self"/);
  assert.equal((xml.match(/<item>/g) || []).length, 2);
});
