// אוסף שני ערוצים (0 = מיקרופון, 1 = טאב) ל-PCM16LE interleaved במנות של 100ms.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 1600; // 100ms ב-16kHz
    this.buf = new Int16Array(this.frames * 2);
    this.i = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const L = input[0], R = input[1] ?? input[0];
    for (let n = 0; n < L.length; n++) {
      this.buf[this.i++] = Math.max(-32768, Math.min(32767, Math.round(L[n] * 32767)));
      this.buf[this.i++] = Math.max(-32768, Math.min(32767, Math.round(R[n] * 32767)));
      if (this.i >= this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(this.frames * 2);
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
