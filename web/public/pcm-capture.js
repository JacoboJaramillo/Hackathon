// AudioWorklet for /ws/agent: the AudioContext runs at 16 kHz, so the browser
// resamples the microphone and this only converts Float32 to 16-bit PCM and
// sends 40 ms frames (640 samples, 1280 bytes) to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(640);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(640);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
