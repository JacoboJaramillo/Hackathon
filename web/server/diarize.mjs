// Second upstream per voice session: Deepgram streaming STT with diarization
// (RF-007). The agent API does not label speakers, so the same mic audio is
// also sent here and its final words are grouped into speaker turns.
import { WebSocket } from 'ws';

// interim_results=true only because Deepgram rejects utterance_end_ms without it;
// interim Results are ignored below and billing is per audio second either way.
const LISTEN_URL = 'wss://api.deepgram.com/v1/listen?model=nova-3&language=es&diarize=true&punctuate=true'
  + '&smart_format=true&encoding=linear16&sample_rate=16000&channels=1&interim_results=true'
  + '&endpointing=300&utterance_end_ms=1000';
const MERGE_GAP_S = 1.0;
const KEEPALIVE_MS = 5_000;
// Above this the STT socket is lagging; dropping frames keeps memory bounded
// and the agent path untouched.
const MAX_BUFFERED = 1024 * 1024;

const round1 = (s) => Math.round(s * 10) / 10;

function finish(turn) {
  return {
    speaker: turn.speaker,
    text: turn.words.join(' '),
    start: round1(turn.start),
    end: round1(turn.end),
    wordCount: turn.words.length,
  };
}

// Pure: folds one batch of final words into the pending turn. Returns the
// turns closed by a speaker change (or by flush) and the new pending turn.
export function groupWords(pending, words = [], { flush = false } = {}) {
  const done = [];
  let cur = pending;
  for (const w of words) {
    const word = w?.punctuated_word ?? w?.word;
    if (typeof word !== 'string' || !word || !Number.isInteger(w.speaker)) continue;
    if (cur && cur.speaker === w.speaker && w.start - cur.end < MERGE_GAP_S) {
      cur = { ...cur, words: [...cur.words, word], end: w.end };
      continue;
    }
    if (cur) done.push(finish(cur));
    cur = { speaker: w.speaker, words: [word], start: w.start, end: w.end };
  }
  if (flush && cur) {
    done.push(finish(cur));
    cur = null;
  }
  return { done, pending: cur };
}

export function createDiarizer({ apiKey, onTurn, log = () => {}, WebSocketImpl = WebSocket, url = LISTEN_URL }) {
  let pending = null;
  let n = 0;
  let dead = false;
  let turns = 0;
  const ws = new WebSocketImpl(url, { headers: { Authorization: `Token ${apiKey}` }, handshakeTimeout: 10_000 });
  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
  }, KEEPALIVE_MS);
  keepAlive.unref?.();

  const emit = (list) => {
    for (const t of list) {
      turns += 1;
      onTurn({ id: `t${++n}`, ...t });
    }
  };
  const stop = (reason) => {
    if (dead) return;
    dead = true;
    clearInterval(keepAlive);
    if (reason) log('diarize_error', { reason });
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'Results' && msg.is_final) {
      const r = groupWords(pending, msg.channel?.alternatives?.[0]?.words, { flush: Boolean(msg.speech_final) });
      pending = r.pending;
      emit(r.done);
    } else if (msg.type === 'UtteranceEnd') {
      const r = groupWords(pending, [], { flush: true });
      pending = r.pending;
      emit(r.done);
    }
  });
  ws.on('error', (e) => stop(e?.message || 'socket_error'));
  ws.on('close', (code) => stop(dead ? null : `closed_${code}`));

  return {
    send(frame) {
      // ponytail: frames sent before the socket opens are dropped; the agent
      // greeting plays first, so the user rarely speaks in that window.
      if (dead || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
      ws.send(frame, { binary: true });
    },
    close() {
      if (dead) return;
      stop(null);
      log('diarize_end', { turns });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close(1000);
      } else {
        ws.terminate();
      }
    },
  };
}
