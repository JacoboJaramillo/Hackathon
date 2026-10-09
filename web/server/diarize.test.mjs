import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { groupWords, createDiarizer } from './diarize.mjs';

const w = (speaker, start, end, word = 'hola') => ({ speaker, start, end, punctuated_word: word, word });

test('RF-007 consecutive words are split into turns by speaker', () => {
  const { done, pending } = groupWords(null, [w(0, 0, 0.4, 'Hola,'), w(0, 0.5, 0.9, 'doctora.'), w(1, 1.0, 1.3, 'Buenas'), w(1, 1.4, 1.8, 'tardes.')]);
  assert.deepEqual(done, [{ speaker: 0, text: 'Hola, doctora.', start: 0, end: 0.9, wordCount: 2 }]);
  assert.equal(pending.speaker, 1);
  assert.deepEqual(pending.words, ['Buenas', 'tardes.']);
});

test('RF-007 merge rule: same speaker under 1 s gap merges, 1 s or more starts a new turn', () => {
  let r = groupWords(null, [w(0, 0, 0.5, 'uno')]);
  r = groupWords(r.pending, [w(0, 1.2, 1.6, 'dos')]);
  assert.equal(r.done.length, 0);
  assert.deepEqual(r.pending.words, ['uno', 'dos']);
  r = groupWords(r.pending, [w(0, 2.6, 3.0, 'tres')]);
  assert.equal(r.done.length, 1);
  assert.equal(r.done[0].text, 'uno dos');
  assert.deepEqual(r.pending.words, ['tres']);
});

test('RF-007 flush closes the pending turn and rounds times to 1 decimal', () => {
  const r = groupWords(null, [w(2, 0.123, 0.987)], { flush: true });
  assert.equal(r.pending, null);
  assert.deepEqual(r.done, [{ speaker: 2, text: 'hola', start: 0.1, end: 1, wordCount: 1 }]);
  assert.deepEqual(groupWords(null, [], { flush: true }), { done: [], pending: null });
});

test('RF-007 empty or malformed words are ignored', () => {
  const r = groupWords(null, [{ speaker: 0, start: 0, end: 1, punctuated_word: '' }, { start: 0, end: 1, punctuated_word: 'x' }, null]);
  assert.deepEqual(r, { done: [], pending: null });
  assert.deepEqual(groupWords(null, undefined), { done: [], pending: null });
});

class FakeWs extends EventEmitter {
  static last;
  constructor(url, opts) {
    super();
    Object.assign(this, { url, opts, readyState: 1, bufferedAmount: 0, sent: [] });
    FakeWs.last = this;
  }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  terminate() { this.readyState = 3; }
}
const results = (words, speechFinal = false) => Buffer.from(JSON.stringify({
  type: 'Results', is_final: true, speech_final: speechFinal, channel: { alternatives: [{ words }] },
}));

test('RF-007 diarizer emits on speech_final and on UtteranceEnd with sequential ids', () => {
  const turns = [];
  const d = createDiarizer({ apiKey: 'k', onTurn: (t) => turns.push(t), WebSocketImpl: FakeWs });
  const ws = FakeWs.last;
  assert.match(ws.url, /diarize=true/);
  assert.equal(ws.opts.headers.Authorization, 'Token k');
  ws.emit('message', results([w(0, 0, 0.5, 'Hola')]), false);
  assert.equal(turns.length, 0);
  ws.emit('message', results([w(0, 0.6, 1, 'amigo.')], true), false);
  assert.deepEqual(turns.map((t) => [t.id, t.text]), [['t1', 'Hola amigo.']]);
  ws.emit('message', results([w(1, 3, 3.5, 'Gracias.')]), false);
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'UtteranceEnd' })), false);
  assert.deepEqual(turns.map((t) => [t.id, t.speaker]), [['t1', 0], ['t2', 1]]);
  d.close();
  assert.equal(JSON.parse(ws.sent.at(-1)).type, 'CloseStream');
});

test('RF-007 a failed STT socket stops forwarding and logs diarize_error', () => {
  const logs = [];
  const d = createDiarizer({ apiKey: 'k', onTurn: () => {}, log: (e) => logs.push(e), WebSocketImpl: FakeWs });
  const ws = FakeWs.last;
  d.send(Buffer.alloc(4));
  ws.emit('error', new Error('boom'));
  d.send(Buffer.alloc(4));
  assert.equal(ws.sent.length, 1);
  assert.deepEqual(logs, ['diarize_error']);
  d.close();
});
