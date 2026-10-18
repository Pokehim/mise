// Reads a 3DGS binary PLY (float properties) into compact typed arrays:
// pos (Float32 xyz), opacity (sigmoid), maxScale (exp), minScale, midScale, color (f_dc -> rgb 0..1).
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

export function readSplatPly(path) {
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(16384);
  readSync(fd, head, 0, head.length, 0);
  const end = head.indexOf('end_header\n');
  const headerText = head.slice(0, end).toString('latin1');
  const dataStart = end + 'end_header\n'.length;
  const lines = headerText.split('\n');
  let count = 0;
  const props = [];
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element' && p[1] === 'vertex') count = +p[2];
    if (p[0] === 'property') {
      if (p[1] !== 'float') throw new Error('non-float property ' + l);
      props.push(p[2]);
    }
  }
  const stride = props.length * 4;
  const ix = Object.fromEntries(props.map((n, i) => [n, i]));
  const nRest = props.filter((p) => p.startsWith('f_rest_')).length;
  const shDegree = nRest === 45 ? 3 : nRest === 24 ? 2 : nRest === 9 ? 1 : 0;
  const pos = new Float32Array(count * 3);
  const opacity = new Float32Array(count);
  const maxScale = new Float32Array(count);
  const minScale = new Float32Array(count);
  const midScale = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const shAbs = new Float32Array(count); // mean |f_rest|
  const chunk = 65536;
  const buf = Buffer.alloc(chunk * stride);
  const SH_C0 = 0.28209479177387814;
  let done = 0;
  while (done < count) {
    const n = Math.min(chunk, count - done);
    readSync(fd, buf, 0, n * stride, dataStart + done * stride);
    const f = new Float32Array(buf.buffer, buf.byteOffset, n * props.length);
    for (let i = 0; i < n; i++) {
      const o = i * props.length, g = done + i;
      pos[3 * g] = f[o + ix.x]; pos[3 * g + 1] = f[o + ix.y]; pos[3 * g + 2] = f[o + ix.z];
      opacity[g] = 1 / (1 + Math.exp(-f[o + ix.opacity]));
      const s = [Math.exp(f[o + ix.scale_0]), Math.exp(f[o + ix.scale_1]), Math.exp(f[o + ix.scale_2])].sort((a, b) => a - b);
      minScale[g] = s[0]; midScale[g] = s[1]; maxScale[g] = s[2];
      color[3 * g] = 0.5 + SH_C0 * f[o + ix.f_dc_0];
      color[3 * g + 1] = 0.5 + SH_C0 * f[o + ix.f_dc_1];
      color[3 * g + 2] = 0.5 + SH_C0 * f[o + ix.f_dc_2];
      if (nRest) {
        let a = 0;
        for (let r = 0; r < nRest; r++) a += Math.abs(f[o + ix.f_rest_0 + r]);
        shAbs[g] = a / nRest;
      }
    }
    done += n;
  }
  closeSync(fd);
  return { count, props, shDegree, pos, opacity, maxScale, minScale, midScale, color, shAbs };
}
