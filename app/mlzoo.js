/* AlphaLab ML Zoo: JavaScript ports of open-source quant ML models, trained in the browser on the
   bundled real data. Every model here is a re-implementation of a published, permissively licensed
   reference (see ML.SOURCES for repo, file and license). Nothing is downloaded at runtime.

   - Tensor autograd (micrograd-style reverse mode, batched)           karpathy/micrograd (MIT)
   - LSTM, GRU, ALSTM, Transformer sequence models                      microsoft/qlib (MIT)
   - Histogram CART, Random Forest, Extra Trees                         scikit-learn (BSD-3)
   - LightGBM-style GBDT (shrinkage, row/col subsampling, L2 leaves)     microsoft/qlib gbdt.py (MIT)
   - Elastic Net (coordinate descent), Gaussian Naive Bayes             scikit-learn (BSD-3)
   - Pegasos linear SVM                                                 stefan-jansen/ml-for-trading (MIT)
   - DQN trading agent                                                  AI4Finance-Foundation/FinRL (MIT)
   - Gaussian HMM (Baum-Welch, causal forward filter)                   hmmlearn (BSD-3)
   - Kalman dynamic hedge ratio                                         pykalman (BSD)
   - GARCH(1,1) by maximum likelihood                                   bashtage/arch (NCSA)
   - OLMAR online portfolio                                             Marigold/universal-portfolios (MIT)
   - Triple barrier, meta-labeling, FFD, purge + embargo                BlackArbsCEO/Adv_Fin_ML_Exercises (MIT)
   - Alpha158 feature set                                               microsoft/qlib loader.py (MIT) */
'use strict';
(function () {
const Z = ML.zoo = {};

/* =========================================================
   1. TENSOR AUTOGRAD. 2-D tensors on Float64Array, reverse-mode.
   ========================================================= */
class T {
  constructor(r, c, data, parents, back) {
    this.r = r; this.c = c;
    this.d = data || new Float64Array(r * c);
    this.g = null; this.p = parents || null; this.back = back || null;
  }
  grad() { if (!this.g) this.g = new Float64Array(this.r * this.c); return this.g; }
}
Z.T = T;
const tensor = (r, c, arr) => new T(r, c, arr instanceof Float64Array ? arr : Float64Array.from(arr));
function param(r, c, rand, scale) {
  const t = new T(r, c);
  const s = scale ?? Math.sqrt(1 / r);
  for (let i = 0; i < t.d.length; i++) t.d[i] = (rand() * 2 - 1) * s;
  t.isParam = true;
  return t;
}
const op = {
  matmul(A, B) { // [r,k] x [k,c]
    const r = A.r, k = A.c, c = B.c, out = new T(r, c, null, [A, B]);
    const a = A.d, b = B.d, o = out.d;
    for (let i = 0; i < r; i++) for (let t = 0; t < k; t++) {
      const av = a[i * k + t]; if (av === 0) continue;
      const bo = t * c, oo = i * c;
      for (let j = 0; j < c; j++) o[oo + j] += av * b[bo + j];
    }
    out.back = () => {
      const g = out.g, ga = A.grad(), gb = B.grad();
      for (let i = 0; i < r; i++) for (let t = 0; t < k; t++) {
        let s = 0; const bo = t * c, oo = i * c, av = a[i * k + t];
        for (let j = 0; j < c; j++) { s += g[oo + j] * b[bo + j]; gb[bo + j] += av * g[oo + j]; }
        ga[i * k + t] += s;
      }
    };
    return out;
  },
  add(A, B) { // B same shape or a [1,c] row broadcast
    const out = new T(A.r, A.c, null, [A, B]), bc = B.r === 1 && A.r > 1, c = A.c;
    for (let i = 0; i < out.d.length; i++) out.d[i] = A.d[i] + B.d[bc ? i % c : i];
    out.back = () => {
      const g = out.g, ga = A.grad(), gb = B.grad();
      for (let i = 0; i < g.length; i++) { ga[i] += g[i]; gb[bc ? i % c : i] += g[i]; }
    };
    return out;
  },
  addConst(A, K) { // K: Float64Array constant (no grad), same shape
    const out = new T(A.r, A.c, null, [A]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = A.d[i] + K[i];
    out.back = () => { const g = out.g, ga = A.grad(); for (let i = 0; i < g.length; i++) ga[i] += g[i]; };
    return out;
  },
  mul(A, B) {
    const out = new T(A.r, A.c, null, [A, B]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = A.d[i] * B.d[i];
    out.back = () => {
      const g = out.g, ga = A.grad(), gb = B.grad();
      for (let i = 0; i < g.length; i++) { ga[i] += g[i] * B.d[i]; gb[i] += g[i] * A.d[i]; }
    };
    return out;
  },
  mulCol(A, a) { // A [r,c] times column a [r,1]
    const out = new T(A.r, A.c, null, [A, a]), c = A.c;
    for (let i = 0; i < out.d.length; i++) out.d[i] = A.d[i] * a.d[(i / c) | 0];
    out.back = () => {
      const g = out.g, gA = A.grad(), ga = a.grad();
      for (let i = 0; i < g.length; i++) { const rr = (i / c) | 0; gA[i] += g[i] * a.d[rr]; ga[rr] += g[i] * A.d[i]; }
    };
    return out;
  },
  affine(A, s, b) { // s*A + b
    const out = new T(A.r, A.c, null, [A]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = s * A.d[i] + b;
    out.back = () => { const g = out.g, ga = A.grad(); for (let i = 0; i < g.length; i++) ga[i] += s * g[i]; };
    return out;
  },
  tanh(A) {
    const out = new T(A.r, A.c, null, [A]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = Math.tanh(A.d[i]);
    out.back = () => { const g = out.g, ga = A.grad(); for (let i = 0; i < g.length; i++) ga[i] += g[i] * (1 - out.d[i] * out.d[i]); };
    return out;
  },
  sigmoid(A) {
    const out = new T(A.r, A.c, null, [A]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = 1 / (1 + Math.exp(-A.d[i]));
    out.back = () => { const g = out.g, ga = A.grad(); for (let i = 0; i < g.length; i++) ga[i] += g[i] * out.d[i] * (1 - out.d[i]); };
    return out;
  },
  relu(A) {
    const out = new T(A.r, A.c, null, [A]);
    for (let i = 0; i < out.d.length; i++) out.d[i] = A.d[i] > 0 ? A.d[i] : 0;
    out.back = () => { const g = out.g, ga = A.grad(); for (let i = 0; i < g.length; i++) if (A.d[i] > 0) ga[i] += g[i]; };
    return out;
  },
  hcat(list) { // concat along columns
    const r = list[0].r, C = list.reduce((s, t) => s + t.c, 0), out = new T(r, C, null, list);
    let off = 0;
    for (const t of list) { for (let i = 0; i < r; i++) for (let j = 0; j < t.c; j++) out.d[i * C + off + j] = t.d[i * t.c + j]; off += t.c; }
    out.back = () => {
      let o2 = 0;
      for (const t of list) { const gt = t.grad(); for (let i = 0; i < r; i++) for (let j = 0; j < t.c; j++) gt[i * t.c + j] += out.g[i * C + o2 + j]; o2 += t.c; }
    };
    return out;
  },
  vcat(list) { // stack rows
    const c = list[0].c, R = list.reduce((s, t) => s + t.r, 0), out = new T(R, c, null, list);
    let off = 0;
    for (const t of list) { out.d.set(t.d, off); off += t.d.length; }
    out.back = () => { let o2 = 0; for (const t of list) { const gt = t.grad(); for (let i = 0; i < t.d.length; i++) gt[i] += out.g[o2 + i]; o2 += t.d.length; } };
    return out;
  },
  cols(A, s, e) {
    const w = e - s, out = new T(A.r, w, null, [A]);
    for (let i = 0; i < A.r; i++) for (let j = 0; j < w; j++) out.d[i * w + j] = A.d[i * A.c + s + j];
    out.back = () => { const ga = A.grad(); for (let i = 0; i < A.r; i++) for (let j = 0; j < w; j++) ga[i * A.c + s + j] += out.g[i * w + j]; };
    return out;
  },
  rows(A, s, e) {
    const out = new T(e - s, A.c, A.d.slice(s * A.c, e * A.c), [A]);
    out.back = () => { const ga = A.grad(); for (let i = 0; i < out.d.length; i++) ga[s * A.c + i] += out.g[i]; };
    return out;
  },
  softmaxRows(A) {
    const out = new T(A.r, A.c, null, [A]), c = A.c;
    for (let i = 0; i < A.r; i++) {
      let m = -Infinity; for (let j = 0; j < c; j++) m = Math.max(m, A.d[i * c + j]);
      let s = 0; for (let j = 0; j < c; j++) { const e = Math.exp(A.d[i * c + j] - m); out.d[i * c + j] = e; s += e; }
      for (let j = 0; j < c; j++) out.d[i * c + j] /= s;
    }
    out.back = () => {
      const ga = A.grad();
      for (let i = 0; i < A.r; i++) {
        let dot = 0; for (let j = 0; j < c; j++) dot += out.g[i * c + j] * out.d[i * c + j];
        for (let j = 0; j < c; j++) ga[i * c + j] += out.d[i * c + j] * (out.g[i * c + j] - dot);
      }
    };
    return out;
  },
  layernorm(A, gain, bias) { // row-wise, learnable gain/bias [1,c]
    const out = new T(A.r, A.c, null, [A, gain, bias]), c = A.c, xh = new Float64Array(A.d.length), inv = new Float64Array(A.r);
    for (let i = 0; i < A.r; i++) {
      let m = 0; for (let j = 0; j < c; j++) m += A.d[i * c + j]; m /= c;
      let v = 0; for (let j = 0; j < c; j++) v += (A.d[i * c + j] - m) ** 2; v /= c;
      inv[i] = 1 / Math.sqrt(v + 1e-5);
      for (let j = 0; j < c; j++) { xh[i * c + j] = (A.d[i * c + j] - m) * inv[i]; out.d[i * c + j] = xh[i * c + j] * gain.d[j] + bias.d[j]; }
    }
    out.back = () => {
      const ga = A.grad(), gg = gain.grad(), gb = bias.grad();
      for (let i = 0; i < A.r; i++) {
        let s1 = 0, s2 = 0;
        for (let j = 0; j < c; j++) {
          const go = out.g[i * c + j]; gg[j] += go * xh[i * c + j]; gb[j] += go;
          const dx = go * gain.d[j]; s1 += dx; s2 += dx * xh[i * c + j];
        }
        for (let j = 0; j < c; j++) {
          const dx = out.g[i * c + j] * gain.d[j];
          ga[i * c + j] += inv[i] * (dx - s1 / c - xh[i * c + j] * s2 / c);
        }
      }
    };
    return out;
  },
  /* multi-head self-attention on t-major rows (row = t*B + b). Qm,Km,Vm [B*T, D]. */
  attention(Qm, Km, Vm, B, Tn, heads, keep) {
    const D = Qm.c, hd = D / heads, sc = 1 / Math.sqrt(hd);
    const out = new T(B * Tn, D, null, [Qm, Km, Vm]);
    const P = new Float64Array(B * heads * Tn * Tn); // attention probs
    const idx = (b, h, t, u) => ((b * heads + h) * Tn + t) * Tn + u;
    for (let b = 0; b < B; b++) for (let h = 0; h < heads; h++) {
      for (let t = 0; t < Tn; t++) {
        const qo = (t * B + b) * D + h * hd;
        let m = -Infinity;
        for (let u = 0; u < Tn; u++) {
          const ko = (u * B + b) * D + h * hd; let s = 0;
          for (let j = 0; j < hd; j++) s += Qm.d[qo + j] * Km.d[ko + j];
          P[idx(b, h, t, u)] = s * sc; if (s * sc > m) m = s * sc;
        }
        let z = 0;
        for (let u = 0; u < Tn; u++) { const e = Math.exp(P[idx(b, h, t, u)] - m); P[idx(b, h, t, u)] = e; z += e; }
        for (let u = 0; u < Tn; u++) {
          const pr = (P[idx(b, h, t, u)] /= z), vo = (u * B + b) * D + h * hd;
          for (let j = 0; j < hd; j++) out.d[qo + j] += pr * Vm.d[vo + j];
        }
      }
    }
    if (keep) keep.P = P;
    out.back = () => {
      const gQ = Qm.grad(), gK = Km.grad(), gV = Vm.grad();
      const dP = new Float64Array(Tn);
      for (let b = 0; b < B; b++) for (let h = 0; h < heads; h++) for (let t = 0; t < Tn; t++) {
        const qo = (t * B + b) * D + h * hd;
        let dot = 0;
        for (let u = 0; u < Tn; u++) {
          const vo = (u * B + b) * D + h * hd, pr = P[idx(b, h, t, u)]; let s = 0;
          for (let j = 0; j < hd; j++) { s += out.g[qo + j] * Vm.d[vo + j]; gV[vo + j] += pr * out.g[qo + j]; }
          dP[u] = s; dot += s * pr;
        }
        for (let u = 0; u < Tn; u++) {
          const ds = P[idx(b, h, t, u)] * (dP[u] - dot) * sc, ko = (u * B + b) * D + h * hd;
          for (let j = 0; j < hd; j++) { gQ[qo + j] += ds * Km.d[ko + j]; gK[ko + j] += ds * Qm.d[qo + j]; }
        }
      }
    };
    return out;
  },
  mse(Pr, Y) { // Y Float64Array, returns [1,1]
    const n = Pr.d.length, out = new T(1, 1, null, [Pr]);
    let s = 0; for (let i = 0; i < n; i++) s += (Pr.d[i] - Y[i]) ** 2;
    out.d[0] = s / n;
    out.back = () => { const g = Pr.grad(); for (let i = 0; i < n; i++) g[i] += out.g[0] * 2 * (Pr.d[i] - Y[i]) / n; };
    return out;
  },
};
Z.op = op;
function backward(loss) {
  const topo = [], seen = new Set();
  // iterative DFS to avoid deep recursion on long sequences
  const stack = [[loss, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1], v = top[0];
    if (top[1] === 0) { if (seen.has(v)) { stack.pop(); continue; } seen.add(v); }
    if (v.p && top[1] < v.p.length) { const q = v.p[top[1]++]; if (!seen.has(q)) stack.push([q, 0]); }
    else { stack.pop(); topo.push(v); }
  }
  loss.grad()[0] = 1;
  for (let i = topo.length - 1; i >= 0; i--) if (topo[i].back && topo[i].g) topo[i].back();
}
Z.backward = backward;
class Adam {
  constructor(params, lr = 3e-3, wd = 0) {
    this.ps = params; this.lr = lr; this.wd = wd; this.t = 0;
    this.m = params.map(p => new Float64Array(p.d.length)); this.v = params.map(p => new Float64Array(p.d.length));
  }
  step() {
    this.t++;
    const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    this.ps.forEach((p, k) => {
      if (!p.g) return;
      const m = this.m[k], v = this.v[k];
      for (let i = 0; i < p.d.length; i++) {
        const g = Math.max(-5, Math.min(5, p.g[i] + this.wd * p.d[i])); // clip, as qlib does with clip_grad_value_
        m[i] = b1 * m[i] + (1 - b1) * g; v[i] = b2 * v[i] + (1 - b2) * g * g;
        p.d[i] -= this.lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
      p.g = null;
    });
  }
}
Z.Adam = Adam;

/* =========================================================
   2. SEQUENCE MODELS (qlib layout: a row is feature-major, x[f*T + t])
   ========================================================= */
function seqSlices(Xb, d, Tn) { // Xb: array of rows -> list of T tensors [B,d]
  const B = Xb.length, out = [];
  for (let t = 0; t < Tn; t++) {
    const m = new T(B, d);
    for (let b = 0; b < B; b++) for (let f = 0; f < d; f++) m.d[b * d + f] = Xb[b][f * Tn + t];
    out.push(m);
  }
  return out;
}
const NETS = {
  lstm: { // qlib pytorch_lstm.py: nn.LSTM -> fc_out(last hidden)
    init(d, H, rand) { return { W: param(d + H, 4 * H, rand), b: param(1, 4 * H, rand, 0), Wo: param(H, 1, rand), bo: param(1, 1, rand, 0) }; },
    forward(P, xs, H) {
      const B = xs[0].r; let h = new T(B, H), c = new T(B, H);
      for (const x of xs) {
        const z = op.add(op.matmul(op.hcat([x, h]), P.W), P.b);
        const i = op.sigmoid(op.cols(z, 0, H)), f = op.sigmoid(op.affine(op.cols(z, H, 2 * H), 1, 1)); // +1 forget bias
        const g = op.tanh(op.cols(z, 2 * H, 3 * H)), o = op.sigmoid(op.cols(z, 3 * H, 4 * H));
        c = op.add(op.mul(f, c), op.mul(i, g)); h = op.mul(o, op.tanh(c));
      }
      return { out: op.add(op.matmul(h, P.Wo), P.bo) };
    },
  },
  gru: { // qlib pytorch_gru.py
    init(d, H, rand) { return { Wzr: param(d + H, 2 * H, rand), bzr: param(1, 2 * H, rand, 0), Wn: param(d + H, H, rand), bn: param(1, H, rand, 0), Wo: param(H, 1, rand), bo: param(1, 1, rand, 0) }; },
    cell(P, x, h, H) {
      const zr = op.sigmoid(op.add(op.matmul(op.hcat([x, h]), P.Wzr), P.bzr));
      const z = op.cols(zr, 0, H), r = op.cols(zr, H, 2 * H);
      const n = op.tanh(op.add(op.matmul(op.hcat([x, op.mul(r, h)]), P.Wn), P.bn));
      return op.add(op.mul(op.affine(z, -1, 1), n), op.mul(z, h));
    },
    forward(P, xs, H) {
      let h = new T(xs[0].r, H);
      for (const x of xs) h = NETS.gru.cell(P, x, h, H);
      return { out: op.add(op.matmul(h, P.Wo), P.bo) };
    },
  },
  alstm: { // qlib pytorch_alstm.py: fc_in+tanh -> GRU -> attention over time -> fc_out(concat(last, attended))
    init(d, H, rand) {
      const g = NETS.gru.init(H, H, rand);
      return { Win: param(d, H, rand), bin: param(1, H, rand, 0), Wzr: g.Wzr, bzr: g.bzr, Wn: g.Wn, bn: g.bn,
        Wa1: param(H, Math.max(2, H >> 1), rand), ba1: param(1, Math.max(2, H >> 1), rand, 0), Wa2: param(Math.max(2, H >> 1), 1, rand),
        Wo: param(2 * H, 1, rand), bo: param(1, 1, rand, 0) };
    },
    forward(P, xs, H) {
      const B = xs[0].r; let h = new T(B, H); const hs = [], sc = [];
      for (const x of xs) {
        h = NETS.gru.cell(P, op.tanh(op.add(op.matmul(x, P.Win), P.bin)), h, H);
        hs.push(h); sc.push(op.matmul(op.tanh(op.add(op.matmul(h, P.Wa1), P.ba1)), P.Wa2));
      }
      const att = op.softmaxRows(op.hcat(sc)); // [B,T]
      let ctx = null;
      hs.forEach((ht, t) => { const term = op.mulCol(ht, op.cols(att, t, t + 1)); ctx = ctx ? op.add(ctx, term) : term; });
      return { out: op.add(op.matmul(op.hcat([h, ctx]), P.Wo), P.bo), att };
    },
  },
  transformer: { // qlib pytorch_transformer.py: feature_layer -> PositionalEncoding -> TransformerEncoder -> decoder(last step)
    init(d, H, rand) {
      const D = H;
      return { Win: param(d, D, rand), bin: param(1, D, rand, 0), Wq: param(D, D, rand), Wk: param(D, D, rand), Wv: param(D, D, rand), Wp: param(D, D, rand),
        g1: onesRow(D), b1: param(1, D, rand, 0), W1: param(D, 2 * D, rand), c1: param(1, 2 * D, rand, 0), W2: param(2 * D, D, rand), c2: param(1, D, rand, 0),
        g2: onesRow(D), b2: param(1, D, rand, 0), Wo: param(D, 1, rand), bo: param(1, 1, rand, 0) };
    },
    forward(P, xs, H, keep) {
      const B = xs[0].r, Tn = xs.length, D = H;
      let X = op.add(op.matmul(op.vcat(xs), P.Win), P.bin); // [T*B, D], t-major
      X = op.addConst(X, posEnc(Tn, B, D));
      const att = op.matmul(op.attention(op.matmul(X, P.Wq), op.matmul(X, P.Wk), op.matmul(X, P.Wv), B, Tn, 2, keep), P.Wp);
      X = op.layernorm(op.add(X, att), P.g1, P.b1);
      const ff = op.add(op.matmul(op.relu(op.add(op.matmul(X, P.W1), P.c1)), P.W2), P.c2);
      X = op.layernorm(op.add(X, ff), P.g2, P.b2);
      return { out: op.add(op.matmul(op.rows(X, (Tn - 1) * B, Tn * B), P.Wo), P.bo) };
    },
  },
};
function onesRow(c) { const t = new T(1, c); t.d.fill(1); t.isParam = true; return t; }
const _pe = new Map();
function posEnc(Tn, B, D) {
  const k = Tn + ',' + B + ',' + D;
  if (_pe.has(k)) return _pe.get(k);
  const pe = new Float64Array(Tn * B * D);
  for (let t = 0; t < Tn; t++) for (let j = 0; j < D; j++) {
    const ang = t / Math.pow(10000, (2 * Math.floor(j / 2)) / D), v = j % 2 ? Math.cos(ang) : Math.sin(ang);
    for (let b = 0; b < B; b++) pe[(t * B + b) * D + j] = v;
  }
  if (_pe.size > 20) _pe.clear();
  _pe.set(k, pe);
  return pe;
}
Z.NETS = NETS;

/* A training session that can be stepped (UI animates it) or run to completion (walk-forward). */
Z.seqTrainer = function (net, X, y, p = {}) {
  const Tn = p.T ?? p.seqT ?? 20, d = Math.round(X[0].length / Tn), H = p.hidden ?? (net === 'transformer' ? 16 : 12);
  const rand = AL.rng(p.seed ?? 17);
  const ysd = Q.std(y) || 1, ys = y.map(v => v / ysd);
  const P = p._state && p._state.net === net && p._state.d === d ? p._state.P : NETS[net].init(d, H, rand);
  const params = Object.values(P);
  const opt = p._state && p._state.opt && p._state.P === P ? p._state.opt : new Adam(params, p.lr ?? 3e-3, 1e-4);
  const cap = p.trainCap ?? 1200;
  const i0 = Math.max(0, X.length - cap);
  const idx = Array.from({ length: X.length - i0 }, (_, k) => i0 + k);
  const bs = p.batch ?? 64;
  const losses = [];
  const step = () => { // one epoch
    for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
    let tot = 0, nb = 0;
    for (let s = 0; s < idx.length; s += bs) {
      const bi = idx.slice(s, s + bs);
      const xs = seqSlices(bi.map(i => X[i]), d, Tn);
      const { out } = NETS[net].forward(P, xs, H);
      const loss = op.mse(out, Float64Array.from(bi.map(i => ys[i])));
      backward(loss); opt.step();
      tot += loss.d[0]; nb++;
    }
    losses.push(tot / nb);
    return losses[losses.length - 1];
  };
  const predict = Xn => {
    const out = [];
    for (let s = 0; s < Xn.length; s += 256) {
      const r = NETS[net].forward(P, seqSlices(Xn.slice(s, s + 256), d, Tn), H);
      for (const v of r.out.d) out.push(v * ysd);
    }
    return out;
  };
  const inspect = Xn => { // attention map for the UI (ALSTM temporal weights or Transformer heads)
    const keep = {}; const r = NETS[net].forward(P, seqSlices(Xn, d, Tn), H, keep);
    return { att: r.att ? Array.from(r.att.d) : null, P: keep.P || null, T: Tn, B: Xn.length };
  };
  if (p._state !== undefined || p.keepState) p._state = { net, d, P, opt };
  return { step, predict, inspect, losses, params: P, nParams: params.reduce((s, t) => s + t.d.length, 0) };
};
function seqModel(net, name) {
  return {
    name, input: 'seq', refit: 252, deep: true,
    fit(X, y, p = {}) {
      if (!('_state' in p)) p._state = null; // walk-forward copies p per run, so warm starts stay inside one run
      const warm = !!(p._state && p._state.net === net);
      const tr = Z.seqTrainer(net, X, y, p);
      const ep = warm ? (p.warmEpochs ?? 2) : (p.epochs ?? 6);
      for (let e = 0; e < ep; e++) tr.step();
      return { predict: tr.predict, losses: tr.losses };
    },
  };
}

/* =========================================================
   3. TREES: histogram CART, Random Forest, Extra Trees, GBDT
   ========================================================= */
function binData(X, nb = 24) {
  const n = X.length, k = X[0].length, edges = [], B = [];
  for (let j = 0; j < k; j++) {
    const col = X.map(r => r[j]).sort((a, b) => a - b), e = [];
    for (let q = 1; q < nb; q++) { const v = col[Math.floor(q / nb * (n - 1))]; if (!e.length || v > e[e.length - 1]) e.push(v); }
    edges.push(e);
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const v = X[i][j]; let lo = 0, hi = e.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v <= e[m]) hi = m; else lo = m + 1; } b[i] = lo; }
    B.push(b);
  }
  return { edges, B, k };
}
/* grows one regression tree on target g (gradient or label) over rows idx. */
function growTree(bd, g, idx, o, rand) {
  const { edges, B, k } = bd, lam = o.lambda ?? 0, minLeaf = o.minLeaf ?? 20;
  const leaf = ids => { let s = 0; for (const i of ids) s += g[i]; return { leaf: true, v: s / (ids.length + lam) }; };
  const build = (ids, depth) => {
    if (depth >= o.depth || ids.length < 2 * minLeaf) return leaf(ids);
    let G = 0; for (const i of ids) G += g[i];
    const parent = G * G / (ids.length + lam);
    let best = null;
    const feats = [];
    for (let j = 0; j < k; j++) if (!o.colFrac || rand() < o.colFrac) feats.push(j);
    if (!feats.length) feats.push(Math.floor(rand() * k));
    for (const j of feats) {
      const nb = edges[j].length + 1, sg = new Float64Array(nb), sn = new Uint32Array(nb), b = B[j];
      for (const i of ids) { sg[b[i]] += g[i]; sn[b[i]]++; }
      if (o.random) { // Extra Trees: one random cut per feature
        const cut = Math.floor(rand() * (nb - 1));
        let gl = 0, nl = 0; for (let t = 0; t <= cut; t++) { gl += sg[t]; nl += sn[t]; }
        const nr = ids.length - nl;
        if (nl >= minLeaf && nr >= minLeaf) { const gain = gl * gl / (nl + lam) + (G - gl) ** 2 / (nr + lam) - parent; if (!best || gain > best.gain) best = { j, cut, gain }; }
        continue;
      }
      let gl = 0, nl = 0;
      for (let t = 0; t < nb - 1; t++) {
        gl += sg[t]; nl += sn[t]; const nr = ids.length - nl;
        if (nl < minLeaf) continue; if (nr < minLeaf) break;
        const gain = gl * gl / (nl + lam) + (G - gl) ** 2 / (nr + lam) - parent;
        if (!best || gain > best.gain) best = { j, cut: t, gain };
      }
    }
    if (!best || best.gain <= (o.minGain ?? 0)) return leaf(ids);
    const L = [], R = [], b = B[best.j];
    for (const i of ids) (b[i] <= best.cut ? L : R).push(i);
    if (o.imp) o.imp[best.j] += best.gain;
    return { j: best.j, thr: edges[best.j][best.cut], L: build(L, depth + 1), R: build(R, depth + 1) };
  };
  return build(idx, 0);
}
function treePredict(t, row) { while (!t.leaf) t = row[t.j] <= t.thr ? t.L : t.R; return t.v; }
Z.binData = binData; Z.growTree = growTree; Z.treePredict = treePredict;

function forest(random) {
  return {
    name: random ? 'Extra Trees' : 'Random Forest', refit: 126,
    fit(X, y, p = {}) {
      const rand = AL.rng(p.seed ?? 5), n = X.length, k = X[0].length;
      const bd = binData(X), nT = p.trees ?? 40, imp = new Float64Array(k), trees = [];
      const mtry = p.colFrac ?? Math.max(Math.sqrt(k) / k, 0.2);
      for (let t = 0; t < nT; t++) {
        const idx = random ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: n }, () => Math.floor(rand() * n));
        trees.push(growTree(bd, y, idx, { depth: p.depth ?? 5, minLeaf: p.minLeaf ?? 30, colFrac: mtry, random, imp }, rand));
      }
      return { imp: Array.from(imp), predict: Xn => Xn.map(r => trees.reduce((s, tr) => s + treePredict(tr, r), 0) / nT) };
    },
  };
}
const gbdt = {
  name: 'LightGBM-style GBDT', refit: 252,
  fit(X, y, p = {}) { // qlib gbdt.py defaults scaled down: shrinkage, subsample 0.7, colsample 0.8, L2 leaves
    const rand = AL.rng(p.seed ?? 9), n = X.length, k = X[0].length;
    const bd = binData(X), rounds = p.rounds ?? 80, lr = p.lr ?? 0.05, imp = new Float64Array(k);
    const base = Q.mean(y), F = new Float64Array(n).fill(base), trees = [];
    for (let r = 0; r < rounds; r++) {
      const g = y.map((v, i) => v - F[i]);
      const idx = []; for (let i = 0; i < n; i++) if (rand() < (p.subsample ?? 0.7)) idx.push(i);
      const tr = growTree(bd, g, idx, { depth: p.depth ?? 3, minLeaf: p.minLeaf ?? 40, colFrac: p.colsample ?? 0.8, lambda: p.l2 ?? 5, imp }, rand);
      trees.push(tr);
      for (let i = 0; i < n; i++) F[i] += lr * treePredict(tr, X[i]);
    }
    return { imp: Array.from(imp), predict: Xn => Xn.map(r => base + lr * trees.reduce((s, tr) => s + treePredict(tr, r), 0)) };
  },
};

/* =========================================================
   4. LINEAR / PROBABILISTIC: Elastic Net, Pegasos SVM, Gaussian NB
   ========================================================= */
const elasticnet = {
  name: 'Elastic Net',
  fit(X, y, p = {}) { // sklearn coordinate descent on standardized X
    const n = X.length, k = X[0].length, a = p.alpha ?? 0.02, l1 = p.l1Ratio ?? 0.5;
    const ym = Q.mean(y), ysd = Q.std(y) || 1, yc = y.map(v => (v - ym) / ysd);
    const w = new Float64Array(k), r = Float64Array.from(yc);
    const sq = Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[j] * row[j], 0) / n);
    for (let it = 0; it < 60; it++) {
      let maxd = 0;
      for (let j = 0; j < k; j++) {
        let rho = 0; for (let i = 0; i < n; i++) rho += X[i][j] * (r[i] + w[j] * X[i][j]);
        rho /= n;
        const nw = Math.sign(rho) * Math.max(Math.abs(rho) - a * l1, 0) / (sq[j] + a * (1 - l1));
        const dw = nw - w[j];
        if (dw) { for (let i = 0; i < n; i++) r[i] -= dw * X[i][j]; w[j] = nw; maxd = Math.max(maxd, Math.abs(dw)); }
      }
      if (maxd < 1e-6) break;
    }
    return { w: Array.from(w), predict: Xn => Xn.map(row => ym + ysd * row.reduce((s, v, j) => s + v * w[j], 0)) };
  },
};
const svm = {
  name: 'Linear SVM (Pegasos)',
  fit(X, y, p = {}) {
    const n = X.length, k = X[0].length, lam = p.lambda ?? 1e-3, rand = AL.rng(p.seed ?? 3);
    const w = new Float64Array(k + 1);
    const iters = p.iters ?? n * 4;
    for (let t = 1; t <= iters; t++) {
      const i = Math.floor(rand() * n), yi = y[i] > 0 ? 1 : -1, eta = 1 / (lam * (t + 100));
      let m = w[0]; for (let j = 0; j < k; j++) m += w[j + 1] * X[i][j];
      for (let j = 1; j <= k; j++) w[j] *= 1 - eta * lam;
      if (yi * m < 1) { w[0] += eta * yi * 0.1; for (let j = 0; j < k; j++) w[j + 1] += eta * yi * X[i][j]; }
    }
    return { predict: Xn => Xn.map(row => Math.tanh(row.reduce((s, v, j) => s + v * w[j + 1], w[0]))) };
  },
};
const gnb = {
  name: 'Gaussian Naive Bayes',
  fit(X, y) {
    const k = X[0].length, cls = [0, 1].map(c => {
      const rows = X.filter((_, i) => (y[i] > 0 ? 1 : 0) === c);
      return { prior: rows.length / X.length, mu: Array.from({ length: k }, (_, j) => Q.mean(rows.map(r => r[j]))),
        v: Array.from({ length: k }, (_, j) => Q.std(rows.map(r => r[j])) ** 2 + 1e-3) };
    });
    const ll = (c, row) => Math.log(c.prior || 1e-9) + row.reduce((s, x, j) => s - 0.5 * Math.log(2 * Math.PI * c.v[j]) - (x - c.mu[j]) ** 2 / (2 * c.v[j]), 0);
    return { predict: Xn => Xn.map(row => { const a = ll(cls[0], row), b = ll(cls[1], row), m = Math.max(a, b); const pu = Math.exp(b - m) / (Math.exp(a - m) + Math.exp(b - m)); return 2 * pu - 1; }) };
  },
};

/* =========================================================
   5. DQN trading agent (FinRL-style: state = features + position, actions short/flat/long)
   ========================================================= */
const dqn = {
  name: 'DQN Agent', discrete: true, refit: 252,
  fit(X, y, p = {}) {
    const rand = AL.rng(p.seed ?? 21), k = X[0].length + 1, H = p.hidden ?? 16, A = [-1, 0, 1];
    const mk = () => ({ W1: param(k, H, rand), b1: param(1, H, rand, 0), W2: param(H, 3, rand), b2: param(1, 3, rand, 0) });
    const net = mk(), fwd = (P, S) => op.add(op.matmul(op.tanh(op.add(op.matmul(S, P.W1), P.b1)), P.W2), P.b2);
    const tgt = () => Object.fromEntries(Object.entries(net).map(([kk, t]) => [kk, new T(t.r, t.c, t.d.slice())]));
    let target = tgt();
    const opt = new Adam(Object.values(net), 1e-3);
    const cost = (p.costBps ?? 5) / 1e4, gamma = p.gamma ?? 0.9, h = p.horizon ?? 5;
    const rew = y.map(v => v / h * 100); // per-step reward in percent
    const n = X.length, start = Math.max(0, n - (p.trainCap ?? 1500)), buf = [];
    const state = (i, pos) => [...X[i], pos];
    let eps = 1, steps = 0;
    for (let ep = 0; ep < (p.episodes ?? 4); ep++) {
      let pos = 0;
      for (let i = start; i < n - 1; i++) {
        const s = state(i, pos);
        let a;
        if (rand() < eps) a = Math.floor(rand() * 3);
        else { const q = fwd(net, tensor(1, k, s)).d; a = q.indexOf(Math.max(...q)); }
        const r = A[a] * rew[i] - cost * 100 * Math.abs(A[a] - pos);
        buf.push([s, a, r, state(i + 1, A[a])]); if (buf.length > 5000) buf.shift();
        pos = A[a]; eps = Math.max(0.05, eps * 0.998); steps++;
        if (buf.length >= 128 && steps % 4 === 0) {
          const bt = Array.from({ length: 32 }, () => buf[Math.floor(rand() * buf.length)]);
          const S1 = tensor(32, k, bt.flatMap(b => b[0])), S2 = tensor(32, k, bt.flatMap(b => b[3]));
          const qn = fwd(target, S2).d;
          const q = fwd(net, S1);
          const Y = Float64Array.from(q.d);
          bt.forEach((b, j) => { Y[j * 3 + b[1]] = b[2] + gamma * Math.max(qn[j * 3], qn[j * 3 + 1], qn[j * 3 + 2]); });
          backward(op.mse(q, Y)); opt.step();
        }
        if (steps % 250 === 0) target = tgt();
      }
    }
    let live = 0;
    return { predict: Xn => Xn.map(row => { const q = fwd(net, tensor(1, k, [...row, live])).d; live = A[q.indexOf(Math.max(...q))]; return live; }) };
  },
};

/* =========================================================
   6. Register models into the ML lab
   ========================================================= */
Object.assign(ML.models, {
  lstm: seqModel('lstm', 'LSTM (qlib)'),
  gru: seqModel('gru', 'GRU (qlib)'),
  alstm: seqModel('alstm', 'Attention LSTM (qlib ALSTM)'),
  transformer: seqModel('transformer', 'Transformer Encoder (qlib)'),
  rf: forest(false),
  extratrees: forest(true),
  gbdt,
  elasticnet,
  svm,
  nb: gnb,
  dqn,
});

/* =========================================================
   7. TIME-SERIES MODELS: Gaussian HMM, Kalman hedge, GARCH, OLMAR
   ========================================================= */
Z.hmm = function (obs, K = 3, iters = 25, seed = 1) { // obs: [n][d], diagonal covariances (hmmlearn GaussianHMM)
  const n = obs.length, d = obs[0].length;
  const order = obs.map((o, i) => [o[d - 1], i]).sort((a, b) => a[0] - b[0]); // init by last column (vol) quantiles
  let mu = Array.from({ length: K }, (_, k) => { const sl = order.slice(Math.floor(k * n / K), Math.floor((k + 1) * n / K)).map(x => obs[x[1]]); return Array.from({ length: d }, (_, j) => Q.mean(sl.map(o => o[j]))); });
  let va = Array.from({ length: K }, () => Array.from({ length: d }, (_, j) => Q.std(obs.map(o => o[j])) ** 2 + 1e-8));
  let A = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => i === j ? 0.95 : 0.05 / (K - 1)));
  let pi = new Array(K).fill(1 / K);
  const emis = o => mu.map((m, k) => { let l = 0; for (let j = 0; j < d; j++) l += -0.5 * Math.log(2 * Math.PI * va[k][j]) - (o[j] - m[j]) ** 2 / (2 * va[k][j]); return l; });
  let ll = -Infinity;
  void seed;
  for (let it = 0; it < iters; it++) {
    const E = obs.map(o => { const e = emis(o), m = Math.max(...e); return e.map(x => Math.exp(x - m)); });
    const al = [], c = [];
    for (let t = 0; t < n; t++) {
      const a = new Array(K);
      for (let j = 0; j < K; j++) { let s = 0; if (t === 0) s = pi[j]; else for (let i = 0; i < K; i++) s += al[t - 1][i] * A[i][j]; a[j] = s * E[t][j]; }
      const z = a.reduce((x, y) => x + y, 0) || 1e-300; c.push(z); al.push(a.map(x => x / z));
    }
    const be = new Array(n); be[n - 1] = new Array(K).fill(1);
    for (let t = n - 2; t >= 0; t--) { be[t] = new Array(K); for (let i = 0; i < K; i++) { let s = 0; for (let j = 0; j < K; j++) s += A[i][j] * E[t + 1][j] * be[t + 1][j]; be[t][i] = s / c[t + 1]; } }
    const gam = al.map((a, t) => { const g = a.map((x, k) => x * be[t][k]); const z = g.reduce((x, y) => x + y, 0) || 1; return g.map(x => x / z); });
    const xi = Array.from({ length: K }, () => new Array(K).fill(0));
    for (let t = 0; t < n - 1; t++) {
      let z = 0; const tmp = [];
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) { const v = al[t][i] * A[i][j] * E[t + 1][j] * be[t + 1][j]; tmp.push(v); z += v; }
      for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) xi[i][j] += tmp[i * K + j] / (z || 1);
    }
    pi = gam[0].slice();
    A = xi.map(r => { const s = r.reduce((x, y) => x + y, 0) || 1; return r.map(x => x / s); });
    for (let k = 0; k < K; k++) {
      const w = gam.map(g => g[k]), W = w.reduce((x, y) => x + y, 0) || 1e-9;
      mu[k] = Array.from({ length: d }, (_, j) => obs.reduce((s, o, t) => s + w[t] * o[j], 0) / W);
      va[k] = Array.from({ length: d }, (_, j) => obs.reduce((s, o, t) => s + w[t] * (o[j] - mu[k][j]) ** 2, 0) / W + 1e-8);
    }
    const nll = c.reduce((s, x) => s + Math.log(x), 0);
    if (Math.abs(nll - ll) < 1e-6) break;
    ll = nll;
  }
  // relabel states by ascending variance of the last column, so state 0 = calmest
  const ord = Array.from({ length: K }, (_, k) => k).sort((a, b) => va[a][d - 1] - va[b][d - 1]);
  mu = ord.map(k => mu[k]); va = ord.map(k => va[k]); A = ord.map(i => ord.map(j => A[i][j])); pi = ord.map(k => pi[k]);
  const model = { K, mu, va, A, pi, ll };
  model.filter = (O) => { // causal forward filter: P(state_t | obs_0..t)
    let prev = null; const out = [];
    for (const o of O) {
      const e = emis(o), m = Math.max(...e), E = e.map(x => Math.exp(x - m));
      const a = E.map((x, j) => x * (prev ? prev.reduce((s, pv, i) => s + pv * A[i][j], 0) : pi[j]));
      const z = a.reduce((x, y) => x + y, 0) || 1; prev = a.map(x => x / z); out.push(prev);
    }
    return out;
  };
  return model;
};
/* causal HMM regime probabilities on a return series: refit every `refit` bars on an expanding window */
Z.hmmCausal = function (rets, K = 3, o = {}) {
  const n = rets.length, vol = Q.rollStd(rets, 10);
  const obs = rets.map((r, i) => [r * 100, Math.log((vol[i] || 0.01) * 100 + 1e-6)]);
  const probs = new Array(n).fill(null);
  const minT = o.minTrain ?? 750, refit = o.refit ?? 252;
  let model = null;
  for (let i = minT; i < n; i += refit) {
    const s0 = Math.max(10, i - (o.window ?? 2500));
    model = Z.hmm(obs.slice(s0, i), K, o.iters ?? 20);
    const seg = model.filter(obs.slice(s0, Math.min(n, i + refit)));
    for (let t = i; t < Math.min(n, i + refit); t++) probs[t] = seg[t - s0];
  }
  return { probs, model };
};

Z.kalmanHedge = function (x, y, delta = 1e-4, Ve = 1e-3) { // Chan's dynamic beta: y_t = beta_t x_t + alpha_t + e
  const n = x.length, Vw = delta / (1 - delta);
  let th = [0, 0], P = [[0, 0], [0, 0]], R = null;
  const beta = [], alpha = [], e = [], sq = [];
  for (let t = 0; t < n; t++) {
    R = R ? [[P[0][0] + Vw, P[0][1]], [P[1][0], P[1][1] + Vw]] : [[0, 0], [0, 0]];
    const F = [x[t], 1];
    const yhat = F[0] * th[0] + F[1] * th[1];
    const RF = [R[0][0] * F[0] + R[0][1] * F[1], R[1][0] * F[0] + R[1][1] * F[1]];
    const Qt = F[0] * RF[0] + F[1] * RF[1] + Ve;
    const et = y[t] - yhat;
    const K = [RF[0] / Qt, RF[1] / Qt];
    th = [th[0] + K[0] * et, th[1] + K[1] * et];
    P = [[R[0][0] - K[0] * RF[0], R[0][1] - K[0] * RF[1]], [R[1][0] - K[1] * RF[0], R[1][1] - K[1] * RF[1]]];
    beta.push(th[0]); alpha.push(th[1]); e.push(et); sq.push(Math.sqrt(Qt));
  }
  return { beta, alpha, e, sqrtQ: sq };
};

function nelderMead(f, x0, it = 300, step = 0.1) {
  const n = x0.length;
  let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const v = x0.slice(); v[i] += step; S.push(v); }
  let F = S.map(f);
  for (let k = 0; k < it; k++) {
    const ord = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = ord.map(i => S[i]); F = ord.map(i => F[i]);
    const c = Array.from({ length: n }, (_, j) => S.slice(0, n).reduce((s, v) => s + v[j], 0) / n);
    const lin = t => c.map((v, j) => v + t * (S[n][j] - v));
    const xr = lin(-1), fr = f(xr);
    if (fr < F[0]) { const xe = lin(-2), fe = f(xe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else {
      const xc = lin(0.5), fc = f(xc);
      if (fc < F[n]) { S[n] = xc; F[n] = fc; }
      else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); }
    }
    if (Math.abs(F[n] - F[0]) < 1e-9) break;
  }
  return { x: S[0], f: F[0] };
}
Z.nelderMead = nelderMead;
Z.garch = function (rets) { // GARCH(1,1) MLE, returns in decimal; parametrized to stay stationary
  const r = rets.map(v => v * 100), n = r.length, m = Q.mean(r), e = r.map(v => v - m), v0 = Q.std(e) ** 2;
  const unpack = th => { const w = Math.exp(th[0]), a = 1 / (1 + Math.exp(-th[1])), pers = 1 / (1 + Math.exp(-th[2])); return { w, a: a * pers, b: (1 - a) * pers }; };
  const nll = th => {
    const { w, a, b } = unpack(th); let h = v0, s = 0;
    for (let t = 1; t < n; t++) { h = w + a * e[t - 1] ** 2 + b * h; s += Math.log(h) + e[t] ** 2 / h; }
    return isFinite(s) ? 0.5 * s : 1e12;
  };
  const fit = nelderMead(nll, [Math.log(v0 * 0.03), Math.log(0.1 / 0.9), Math.log(0.97 / 0.03)], 250, 0.5);
  const { w, a, b } = unpack(fit.x);
  const sig = new Array(n); let h = v0;
  for (let t = 0; t < n; t++) { if (t) h = w + a * e[t - 1] ** 2 + b * h; sig[t] = Math.sqrt(h) / 100; }
  const next = w + a * e[n - 1] ** 2 + b * h;
  const lr = a + b < 1 ? w / (1 - a - b) : v0;
  const forecast = hz => { const out = []; let f = next; for (let k = 0; k < hz; k++) { out.push(Math.sqrt(f) / 100); f = lr + (a + b) * (f - lr); } return out; };
  return { omega: w, alpha: a, beta: b, persistence: a + b, longRunVol: Math.sqrt(lr * 252) / 100, sigma: sig, nextSigma: Math.sqrt(next) / 100, forecast, halfLife: Math.log(0.5) / Math.log(a + b), nll: fit.f };
};
/* conditional vol with expanding-window yearly refits (no look-ahead in the parameters) */
Z.garchCausal = function (rets, o = {}) {
  const n = rets.length, sig = new Array(n).fill(NaN), minT = o.minTrain ?? 750, refit = o.refit ?? 252;
  for (let i = minT; i < n; i += refit) {
    const g = Z.garch(rets.slice(Math.max(0, i - 2500), i));
    let h = g.nextSigma * g.nextSigma * 1e4; const m = Q.mean(rets.slice(Math.max(0, i - 2500), i)) * 100;
    for (let t = i; t < Math.min(n, i + refit); t++) { sig[t] = Math.sqrt(h) / 100; const eps = rets[t] * 100 - m; h = g.omega + g.alpha * eps * eps + g.beta * h; }
  }
  return sig;
};

Z.olmar = function (cols, syms, o = {}) { // Li & Hoi (2012) OLMAR-1 with simplex projection
  const n = cols[syms[0]].length, m = syms.length, W = o.window ?? 5, eps = o.eps ?? 10;
  let b = new Array(m).fill(1 / m);
  const weights = Object.fromEntries(syms.map(s => [s, new Array(n).fill(0)]));
  for (let t = W; t < n; t++) {
    const x = syms.map(s => { const px = cols[s]; let sm = 0; for (let k = 0; k < W; k++) sm += px[t - k]; return sm / W / px[t]; });
    const xm = Q.mean(x), bx = b.reduce((s, v, i) => s + v * x[i], 0);
    const nrm = x.reduce((s, v) => s + (v - xm) ** 2, 0);
    const lam = nrm ? Math.max(0, (eps - bx) / nrm) : 0;
    b = simplex(b.map((v, i) => v + lam * (x[i] - xm)));
    syms.forEach((s, i) => { weights[s][t] = b[i]; });
  }
  return weights;
};
function simplex(v) { // Duchi et al. projection onto the probability simplex
  const u = v.slice().sort((a, b) => b - a); let css = 0, rho = 0, th = 0;
  for (let i = 0; i < u.length; i++) { css += u[i]; const t = (css - 1) / (i + 1); if (u[i] - t > 0) { rho = i; th = t; } }
  void rho;
  return v.map(x => Math.max(x - th, 0));
}
Z.simplex = simplex;

/* =========================================================
   8. DE PRADO TOOLKIT (Advances in Financial ML, ch. 3-7)
   ========================================================= */
Z.dailyVol = function (rets, span = 50) { const a = 2 / (span + 1); let m = 0, v = 1e-4; return rets.map(r => { m = a * r + (1 - a) * m; v = a * (r - m) ** 2 + (1 - a) * v; return Math.sqrt(v); }); };
Z.tripleBarrier = function (rets, i, h, up, dn) { // path of cumulative returns after bar i
  let c = 0;
  for (let k = 1; k <= h && i + k < rets.length; k++) {
    c = (1 + c) * (1 + rets[i + k]) - 1;
    if (c >= up) return { label: 1, t: k, ret: c, barrier: 'upper' };
    if (c <= -dn) return { label: -1, t: k, ret: c, barrier: 'lower' };
  }
  return { label: c > 0 ? 1 : -1, t: h, ret: c, barrier: 'vertical' };
};
Z.ffdWeights = function (d, thresh = 1e-4, maxLen = 500) { const w = [1]; for (let k = 1; k < maxLen; k++) { const nw = -w[k - 1] * (d - k + 1) / k; if (Math.abs(nw) < thresh) break; w.push(nw); } return w; };
Z.fracDiff = function (series, d, thresh = 1e-4) {
  const w = Z.ffdWeights(d, thresh), L = w.length, out = new Array(series.length).fill(NaN);
  for (let t = L - 1; t < series.length; t++) { let s = 0; for (let k = 0; k < L; k++) s += w[k] * series[t - k]; out[t] = s; }
  return { values: out, width: L };
};
Z.minFFD = function (logPx) { // smallest d whose FFD series passes ADF at 5%
  const res = [];
  for (let d = 0; d <= 1.0001; d += 0.1) {
    const fd = Z.fracDiff(logPx, +d.toFixed(1)).values.filter(isFinite);
    const adf = Q.adf(fd), corr = Q.corr(fd, logPx.slice(logPx.length - fd.length));
    res.push({ d: +d.toFixed(1), adf: adf.t, corr, stationary: adf.t < -2.86 });
  }
  const best = res.find(r => r.stationary);
  return { table: res, d: best ? best.d : 1 };
};
Z.betSize = p => { const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4), z = (q - 0.5) / Math.sqrt(q * (1 - q)); return 2 * Q.normCdf(z) - 1; };

/* =========================================================
   9. FEATURE SETS: sequences (qlib layout) and Alpha158
   ========================================================= */
Z.seqFeatures = function (sym, horizon = 5, from = '2005-01-01', Tn = 20) {
  const f = ML.makeFeatures(sym, horizon, from);
  const pick = ['rev5', 'mom21', 'vol21', 'rsi14', 'vixZ', 'smaDist'];
  const cols = pick.map(nm => f.names.indexOf(nm)).filter(j => j >= 0);
  const r1 = f.idx.map(pi => pi ? f.px[pi] / f.px[pi - 1] - 1 : 0);
  const d = cols.length + 1, X = [], y = [], dates = [], idx = [];
  for (let i = Tn - 1; i < f.X.length; i++) {
    if (f.idx[i] - f.idx[i - Tn + 1] !== Tn - 1) continue; // need T consecutive trading days
    const row = new Array(d * Tn);
    for (let t = 0; t < Tn; t++) {
      const src = f.X[i - Tn + 1 + t];
      row[t] = r1[i - Tn + 1 + t] * 50;
      cols.forEach((j, c) => { row[(c + 1) * Tn + t] = src[j]; });
    }
    X.push(row); y.push(f.y[i]); dates.push(f.dates[i]); idx.push(f.idx[i]);
  }
  const names = [];
  ['ret1', ...pick].forEach(nm => { for (let t = 0; t < Tn; t++) names.push(nm + '[t-' + (Tn - 1 - t) + ']'); });
  return { X, y, names, dates, idx, px: f.px, allDates: f.allDates, horizon, sym, seq: { d, T: Tn, base: ['ret1', ...pick] } };
};
Z.alpha158 = function (sym, horizon = 5, from = '2005-01-01') {
  const s = AL.getSeries(sym), w = AL.window(s, from), c = w.values, dates = w.dates, n = c.length;
  let o = null, h = null, l = null, v = null;
  const oh = AL.ohlc && AL.ohlc(sym);
  if (oh && oh.dates && oh.dates.length) {
    const mp = new Map(oh.dates.map((d, i) => [d, i]));
    const get = arr => arr ? dates.map(d => mp.has(d) ? arr[mp.get(d)] : NaN) : null;
    o = get(oh.o); h = get(oh.h); l = get(oh.l); v = get(oh.v);
    if (o.filter(isFinite).length < n * 0.9) o = h = l = v = null;
  }
  const feats = [];
  const add = (nm, arr) => feats.push([nm, arr]);
  if (o) {
    add('KMID', c.map((x, i) => (x - o[i]) / o[i]));
    add('KLEN', c.map((x, i) => (h[i] - l[i]) / o[i]));
    add('KMID2', c.map((x, i) => (x - o[i]) / (h[i] - l[i] + 1e-12)));
    add('KUP', c.map((x, i) => (h[i] - Math.max(o[i], x)) / o[i]));
    add('KUP2', c.map((x, i) => (h[i] - Math.max(o[i], x)) / (h[i] - l[i] + 1e-12)));
    add('KLOW', c.map((x, i) => (Math.min(o[i], x) - l[i]) / o[i]));
    add('KLOW2', c.map((x, i) => (Math.min(o[i], x) - l[i]) / (h[i] - l[i] + 1e-12)));
    add('KSFT', c.map((x, i) => (2 * x - h[i] - l[i]) / o[i]));
    add('KSFT2', c.map((x, i) => (2 * x - h[i] - l[i]) / (h[i] - l[i] + 1e-12)));
  }
  const ret = c.map((x, i) => i ? x / c[i - 1] - 1 : 0);
  for (const W of [5, 10, 20, 30, 60]) {
    const roc = [], ma = [], sd = [], beta = [], rsq = [], resi = [], mx = [], mn = [], qu = [], qd = [], rk = [], rsv = [], imax = [], imin = [], imxd = [], cntp = [], cntn = [], cntd = [], sump = [], sumn = [], sumd = [], vma = [], vstd = [];
    const xm = (W - 1) / 2, sxx = W * (W * W - 1) / 12;
    for (let i = 0; i < n; i++) {
      if (i < W) { [roc, ma, sd, beta, rsq, resi, mx, mn, qu, qd, rk, rsv, imax, imin, imxd, cntp, cntn, cntd, sump, sumn, sumd, vma, vstd].forEach(a => a.push(NaN)); continue; }
      const win = c.slice(i - W + 1, i + 1), cur = c[i];
      roc.push(c[i - W] / cur);
      const m = Q.mean(win); ma.push(m / cur); sd.push(Q.std(win) / cur);
      let sxy = 0; for (let k = 0; k < W; k++) sxy += (k - xm) * (win[k] - m);
      const b = sxy / sxx; beta.push(b / cur);
      let sse = 0, sst = 0; for (let k = 0; k < W; k++) { const f = m + b * (k - xm); sse += (win[k] - f) ** 2; sst += (win[k] - m) ** 2; }
      rsq.push(sst ? 1 - sse / sst : 0); resi.push((cur - (m + b * xm)) / cur);
      const hi = h ? Math.max(...h.slice(i - W + 1, i + 1)) : Math.max(...win), lo = l ? Math.min(...l.slice(i - W + 1, i + 1)) : Math.min(...win);
      mx.push(hi / cur); mn.push(lo / cur);
      const srt = win.slice().sort((a, b2) => a - b2);
      qu.push(srt[Math.floor(0.8 * (W - 1))] / cur); qd.push(srt[Math.floor(0.2 * (W - 1))] / cur);
      rk.push(srt.filter(x => x <= cur).length / W);
      rsv.push((cur - lo) / (hi - lo + 1e-12));
      const ai = win.indexOf(Math.max(...win)), bi = win.indexOf(Math.min(...win));
      imax.push((W - 1 - ai) / W); imin.push((W - 1 - bi) / W); imxd.push((ai - bi) / W);
      let up = 0, dn = 0, su = 0, sn = 0;
      for (let k = i - W + 1; k <= i; k++) { const dlt = c[k] - c[k - 1]; if (dlt > 0) { up++; su += dlt; } else if (dlt < 0) { dn++; sn -= dlt; } }
      cntp.push(up / W); cntn.push(dn / W); cntd.push((up - dn) / W);
      sump.push(su / (su + sn + 1e-12)); sumn.push(sn / (su + sn + 1e-12)); sumd.push((su - sn) / (su + sn + 1e-12));
      if (v) { const vw = v.slice(i - W + 1, i + 1); vma.push(Q.mean(vw) / (v[i] + 1e-12)); vstd.push(Q.std(vw) / (v[i] + 1e-12)); }
    }
    add('ROC' + W, roc); add('MA' + W, ma); add('STD' + W, sd); add('BETA' + W, beta); add('RSQR' + W, rsq); add('RESI' + W, resi);
    add('MAX' + W, mx); add('MIN' + W, mn); add('QTLU' + W, qu); add('QTLD' + W, qd); add('RANK' + W, rk); add('RSV' + W, rsv);
    add('IMAX' + W, imax); add('IMIN' + W, imin); add('IMXD' + W, imxd); add('CNTP' + W, cntp); add('CNTN' + W, cntn); add('CNTD' + W, cntd);
    add('SUMP' + W, sump); add('SUMN' + W, sumn); add('SUMD' + W, sumd);
    if (v) { add('VMA' + W, vma); add('VSTD' + W, vstd); }
    add('RVOL' + W, ret.map((_, i) => i < W ? NaN : Q.std(ret.slice(i - W + 1, i + 1)) * Math.sqrt(252)));
  }
  const names = feats.map(f => f[0]), X = [], y = [], kd = [], ki = [];
  for (let i = 0; i < n - horizon; i++) {
    const row = feats.map(f => f[1][i]);
    if (row.some(x => x == null || !isFinite(x))) continue;
    X.push(row); y.push(c[i + horizon] / c[i] - 1); kd.push(dates[i]); ki.push(i);
  }
  return { X, y, names, dates: kd, idx: ki, px: c, allDates: dates, horizon, sym, ohlc: !!o };
};

/* feature builder chosen by the model / registry definition */
ML.featuresFor = function (def, from) {
  const m = ML.models[def.model];
  if (def.features === 'alpha158') return Z.alpha158(def.sym, def.horizon, from);
  if ((m && m.input === 'seq') || def.features === 'seq') return Z.seqFeatures(def.sym, def.horizon, from, def.T || 20);
  return ML.makeFeatures(def.sym, def.horizon, from);
};

/* =========================================================
   10. META-LABELING TWIN: an ML overlay for ANY strategy run.
   The primary strategy picks the side; a secondary model decides whether to take the bet
   and how big (De Prado, AFML ch. 3.6). Trained walk-forward with purging on triple-barrier
   labels of the strategy's own P&L path, conditioned on market-state features.
   ========================================================= */
Z.CATEGORY_MODEL = {
  'Trend Following': 'lstm', 'Momentum': 'gbdt', 'Mean Reversion': 'rf', 'Stat Arb / Pairs': 'gru',
  'Relative Value': 'elasticnet', 'Volatility': 'gbdt', 'Factor Investing': 'rf', 'Macro / Regime': 'logistic',
  'Carry / Seasonality': 'alstm', 'Crypto': 'gru', 'Machine Learning': 'transformer', 'Allocation': 'extratrees',
  'Open-Source ML': 'gbdt',
};
Z.twinModelFor = entry => Z.CATEGORY_MODEL[entry.cat] || 'rf';
const alignTo = (dates, sym) => {
  const s = AL.getSeries(sym); if (!s) return null;
  const mp = new Map(s.dates.map((d, i) => [d, s.values[i]])); let last = null;
  return dates.map(d => { if (mp.has(d)) last = mp.get(d); return last; });
};
Z._twinCache = new Map();
Z.twinCacheKey = (base, modelId) => (base.entry ? base.entry.id : '') + '|' + modelId + '|' + base.costBps;
Z.twinFeatures = function (base) {
  const { dates, rets } = base, n = dates.length;
  const exp = base.exposure || new Array(n).fill(1);
  const spy = alignTo(dates, 'SPY'), vix = alignTo(dates, '^VIX'), curve = alignTo(dates, 'T10Y2Y'), hy = alignTo(dates, 'BAMLH0A0HYM2');
  const spyR = spy.map((v, i) => i && spy[i - 1] ? v / spy[i - 1] - 1 : 0);
  const eq = Q.equity(rets), dd = Q.drawdownSeries ? Q.drawdownSeries(eq) : eq.map((v, i) => v / Math.max(...eq.slice(0, i + 1)) - 1);
  const m21 = Q.sma(rets, 21), m63 = Q.sma(rets, 63), v21 = Q.rollStd(rets, 21), sv21 = Q.rollStd(spyR, 21);
  const vz = Q.zscores(vix.map(v => v ?? 20), 63);
  const hmm = Z.hmmCausal(spyR, 3, { minTrain: 500, refit: 252 });
  const gs = Z.garchCausal(spyR, { minTrain: 500, refit: 252 });
  const names = ['stratMom21', 'stratMom63', 'stratVol21', 'stratDD', 'exposure', 'expChg5', 'spyMom21', 'spyMom63', 'spyVol21', 'vixLvl', 'vixZ', 'curve', 'hyChg21', 'hmmCalm', 'hmmStress', 'garchRatio'];
  const X = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const hp = hmm.probs[i], lrv = sv21[i];
    const row = [m21[i] * 252, m63[i] * 252, v21[i] * Math.sqrt(252), dd[i], exp[i], i >= 5 ? exp[i] - exp[i - 5] : NaN,
      i >= 21 ? spy[i] / spy[i - 21] - 1 : NaN, i >= 63 ? spy[i] / spy[i - 63] - 1 : NaN, sv21[i] * Math.sqrt(252),
      ((vix[i] ?? 20) - 20) / 10, vz[i], curve[i] ?? 0, hy[i] != null && i >= 21 && hy[i - 21] != null ? hy[i] - hy[i - 21] : 0,
      hp ? hp[0] : NaN, hp ? hp[hp.length - 1] : NaN, isFinite(gs[i]) && lrv ? gs[i] / lrv : NaN];
    if (row.every(v => v != null && isFinite(v))) X[i] = row;
  }
  return { X, names, hmm };
};
Z.metaOverlay = function (base, modelId, o = {}) {
  const key = Z.twinCacheKey(base, modelId) + '|' + (o.sizing || 'bet') + '|' + base.dates.length + (o.noCache ? '|live' : '');
  if (Z._twinCache.has(key)) return Z._twinCache.get(key);
  const t0 = Date.now();
  const { dates, rets } = base, n = dates.length, h = o.horizon ?? 10;
  const exp = base.exposure || new Array(n).fill(1);
  const tf = Z.twinFeatures(base);
  const vol = Q.rollStd(rets, 63);
  const model = ML.models[modelId];
  const seqT = model && model.input === 'seq' ? 10 : 0;
  // samples: bar i where the strategy is active next bar, with a complete label window
  const S = [];
  for (let i = Math.max(63, seqT); i < n - 1; i++) {
    if (!tf.X[i] || !(Math.abs(exp[i + 1]) > 1e-6) || !vol[i]) continue;
    if (seqT && tf.X.slice(i - seqT + 1, i + 1).some(r => !r)) continue;
    const bar = 2 * vol[i] * Math.sqrt(h);
    const tb = i + h < n ? Z.tripleBarrier(rets, i, h, bar, bar) : null;
    let x = tf.X[i];
    if (seqT) { x = new Array(tf.names.length * seqT); for (let t = 0; t < seqT; t++) tf.X[i - seqT + 1 + t].forEach((v, f) => { x[f * seqT + t] = v; }); }
    S.push({ i, x, y: tb ? tb.label : null, end: tb ? i + tb.t : Infinity });
  }
  const minTrain = o.minTrain ?? 500, refit = o.refit ?? (model && model.deep ? 252 : 126), embargo = o.embargo ?? 5;
  const prob = new Array(n).fill(NaN);
  const p = { T: seqT || undefined, seqT, epochs: 8, warmEpochs: 3, trainCap: 1500, hidden: 10, trees: 30, rounds: 60, horizon: h, costBps: base.costBps };
  let fitted = null, st = null, lastFit = -Infinity, nFits = 0;
  // resume from prebuilt probabilities (tools/build_mlcache.js) when the history lines up date-for-date
  const ck = Z.twinCacheKey(base, modelId), MC = window.ALPHALAB_MLCACHE && window.ALPHALAB_MLCACHE.meta && window.ALPHALAB_MLCACHE.meta[ck];
  let cN = 0;
  if (MC && !o.noCache && MC.first === dates[0] && MC.n <= n && dates[MC.n - 1] === MC.last) {
    MC.p.split(',').forEach((v, i) => { if (v !== '') prob[i] = +v; }); cN = MC.n;
  }
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    if (s.i < cN) continue;
    if (s.i - lastFit >= refit || !fitted) {
      const tr = S.filter(q => q.y != null && q.end + embargo < s.i); // purge: label fully resolved before today
      if (tr.length >= minTrain) {
        const Xtr = tr.map(q => q.x);
        st = colStatsZ(Xtr);
        fitted = (model || ML.models.logistic).fit(Xtr.map(r => stdz(r, st)), tr.map(q => q.y), p);
        lastFit = s.i; nFits++;
      }
    }
    if (fitted) {
      const out = fitted.predict([stdz(s.x, st)])[0];
      prob[s.i] = Math.min(0.999, Math.max(0.001, (Math.max(-1, Math.min(1, out)) + 1) / 2));
    }
  }
  // sizing -> overlay returns (size decided at close i applies to bar i+1)
  // Weak classifiers put almost every probability near 0.5, where raw De Prado sizing (2*Phi(z)-1)
  // would bet ~2% of capital. So each probability is first calibrated against the model's own PAST
  // out-of-sample probabilities (running mean/sd, causal): at average confidence the twin runs full
  // size, and it de-risks only when the model is unusually pessimistic about the next bet.
  const sizing = o.sizing || 'bet', ema = 2 / (5 + 1);
  let sm = 1, cn = 0, cm = 0, cv = 0; const size = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (!isFinite(prob[i])) { size[i] = sm; continue; }
    const sd = cn > 20 ? Math.sqrt(cv / (cn - 1)) : 0;
    const z = sd > 1e-9 ? (prob[i] - cm) / sd : 0;
    const raw = sizing === 'filter' ? (z > -0.5 ? 1 : 0) : Math.min(1, 2 * Q.normCdf(z));
    cn++; const dl = prob[i] - cm; cm += dl / cn; cv += dl * (prob[i] - cm); // Welford update after use
    sm = ema * raw + (1 - ema) * sm; size[i] = sm;
  }
  const first = prob.findIndex(isFinite);
  if (first < 0) { const r = { ok: false, reason: 'not enough active history to train (' + S.length + ' samples)' }; Z._twinCache.set(key, r); return r; }
  const cost = (base.costBps ?? 5) / 1e4, ov = [], br = [], dd = [], ovExp = [];
  for (let i = first + 1; i < n; i++) {
    ovExp.push((exp[i] || 0) * size[i - 1]);
    ov.push(rets[i] * size[i - 1] - cost * Math.abs(size[i - 1] - (i >= 2 ? size[i - 2] : 1)) * Math.abs(exp[i] || 0));
    br.push(rets[i]); dd.push(dates[i]);
  }
  // classification quality on resolved OOS samples
  const oos = S.filter(s => isFinite(prob[s.i]) && s.y != null);
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const s of oos) { const pr = prob[s.i] > 0.5; if (pr && s.y > 0) tp++; else if (pr) fp++; else if (s.y > 0) fn++; else tn++; }
  const auc = aucOf(oos.map(s => prob[s.i]), oos.map(s => s.y > 0 ? 1 : 0));
  const bench = (base.bench || []).slice(base.bench.length - ov.length);
  const res = {
    ok: true, model: modelId, modelName: (model || ML.models.logistic).name, sizing, dates: dd, rets: ov, baseRets: br,
    equity: Q.equity(ov), baseEquity: Q.equity(br), exposure: ovExp, stats: Q.perf(ov, { bench }), baseStats: Q.perf(br, { bench }),
    size: size.slice(first), prob: prob.slice(first), probDates: dates.slice(first),
    accuracy: oos.length ? (tp + tn) / oos.length : NaN, precision: tp + fp ? tp / (tp + fp) : NaN, recall: tp + fn ? tp / (tp + fn) : NaN,
    baseRate: oos.length ? (tp + fn) / oos.length : NaN, auc, nOOS: oos.length, nFits, featureNames: tf.names,
    importance: fitted && fitted.imp ? tf.names.map((f, j) => ({ feature: f, importance: fitted.imp[j] })).sort((a, b) => b.importance - a.importance) : corrImportance(S, prob, tf.names, seqT),
    ms: Date.now() - t0, cachedRows: cN, rawProb: prob,
  };
  Z._twinCache.set(key, res);
  return res;
};
function colStatsZ(X) { const k = X[0].length, mu = new Array(k).fill(0), sd = new Array(k).fill(0); for (let j = 0; j < k; j++) { const col = X.map(r => r[j]); mu[j] = Q.mean(col); sd[j] = Q.std(col) || 1; } return { mu, sd }; }
function stdz(r, st) { return r.map((v, j) => (v - st.mu[j]) / st.sd[j]); }
function aucOf(score, lab) {
  const pos = lab.filter(x => x).length, neg = lab.length - pos; if (!pos || !neg) return NaN;
  const ord = score.map((s, i) => [s, lab[i]]).sort((a, b) => a[0] - b[0]);
  let rk = 0, sum = 0; ord.forEach((x, i) => { rk = i + 1; if (x[1]) sum += rk; });
  return (sum - pos * (pos + 1) / 2) / (pos * neg);
}
Z.auc = aucOf;
function corrImportance(S, prob, names, seqT) { // |corr| of each feature with the OOS probability
  const rows = S.filter(s => isFinite(prob[s.i])); if (rows.length < 30) return [];
  const pr = rows.map(s => prob[s.i]);
  return names.map((f, j) => ({ feature: f, importance: Math.abs(Q.corr(rows.map(s => seqT ? s.x[j * seqT + seqT - 1] : s.x[j]), pr)) || 0 })).sort((a, b) => b.importance - a.importance);
}

/* a registry entry of kind 'meta': primary strategy + ML meta-label overlay, returned in S.run shape */
Z.metaRun = function (entry, opts = {}) {
  const def = entry.def, baseEntry = S.byId[def.base];
  const base = S.run(baseEntry, { costBps: opts.costBps });
  if (!base || !base.rets) return null;
  const ov = Z.metaOverlay(base, def.model, { sizing: def.sizing, ...(opts.params || {}) });
  if (!ov.ok) return null;
  const bench = base.bench.slice(base.bench.length - ov.rets.length);
  return { entry, dates: ov.dates, rets: ov.rets, bench, benchSym: base.benchSym, stats: Q.perf(ov.rets, { bench }), bstats: Q.perf(bench),
    equity: ov.equity, benchEquity: Q.equity(bench), exposure: ov.exposure, turnover: base.turnover, costBps: base.costBps, meta: ov };
};

/* =========================================================
   11. Strategy engines built on the zoo (registered into S)
   ========================================================= */
if (typeof S !== 'undefined') {
  S.engines.hmmK = function (px, rets, p) { // 3-state Gaussian HMM, causal filter, exposure by regime
    const { probs } = Z.hmmCausal(rets, p.K ?? 3, { minTrain: 750, refit: 126 });
    return probs.map(pr => pr ? pr[0] * (p.calm ?? 1) + (pr.length > 2 ? pr[1] * (p.mid ?? 0.6) : 0) + pr[pr.length - 1] * (p.stress ?? 0) : 0);
  };
  S.engines.garchTarget = function (px, rets, p) { // GARCH(1,1) vol targeting with a 200d trend filter
    const sig = Z.garchCausal(rets, { minTrain: 750, refit: 252 }), sma = Q.sma(px, p.trend ?? 200);
    return sig.map((s, i) => isFinite(s) && s > 0 ? Math.min((p.target ?? 0.12) / (s * Math.sqrt(252)), p.maxLev ?? 1.5) * (!p.trend || px[i] > sma[i] ? 1 : (p.offWeight ?? 0.25)) : 0);
  };
  S.engines.kalmanPair = function (pxA, pxB, p) { // Kalman dynamic hedge, trade the standardized forecast error
    const la = pxA.map(Math.log), lb = pxB.map(Math.log);
    const k = Z.kalmanHedge(lb, la, p.delta ?? 1e-4, p.ve ?? 1e-3);
    const wA = new Array(la.length).fill(0), wB = new Array(la.length).fill(0);
    let pos = 0; const ent = p.entry ?? 1, ex = p.exit ?? 0;
    for (let i = 60; i < la.length; i++) {
      const z = k.e[i] / k.sqrtQ[i];
      if (pos === 0 && z > ent) pos = -1; else if (pos === 0 && z < -ent) pos = 1;
      else if (pos === 1 && z > -ex) pos = 0; else if (pos === -1 && z < ex) pos = 0;
      const b = Math.max(-3, Math.min(3, k.beta[i])), g = 1 + Math.abs(b);
      wA[i] = pos / g; wB[i] = -pos * b / g;
    }
    return { wA, wB };
  };
  S.xs.olmar = function (al, p) {
    const w = Z.olmar(al.cols, al.syms, p);
    if (p.reb && p.reb > 1) for (const s of al.syms) for (let i = 1; i < al.dates.length; i++) if (i % p.reb) w[s][i] = w[s][i - 1];
    return { weights: w, dates: al.dates };
  };
}

/* =========================================================
   12. Provenance: every ported model, its source and license
   ========================================================= */
ML.SOURCES = [
  { id: 'lstm', model: 'LSTM', repo: 'microsoft/qlib', file: 'qlib/contrib/model/pytorch_lstm.py', license: 'MIT', paper: 'Hochreiter & Schmidhuber (1997)' },
  { id: 'gru', model: 'GRU', repo: 'microsoft/qlib', file: 'qlib/contrib/model/pytorch_gru.py', license: 'MIT', paper: 'Cho et al. (2014)' },
  { id: 'alstm', model: 'Attention LSTM (ALSTM)', repo: 'microsoft/qlib', file: 'qlib/contrib/model/pytorch_alstm.py', license: 'MIT', paper: 'Qin et al. (2017), DA-RNN' },
  { id: 'transformer', model: 'Transformer encoder', repo: 'microsoft/qlib', file: 'qlib/contrib/model/pytorch_transformer.py', license: 'MIT', paper: 'Vaswani et al. (2017)' },
  { id: 'gbdt', model: 'LightGBM-style GBDT', repo: 'microsoft/qlib', file: 'qlib/contrib/model/gbdt.py', license: 'MIT', paper: 'Ke et al. (2017), LightGBM' },
  { id: 'alpha158', model: 'Alpha158 features', repo: 'microsoft/qlib', file: 'qlib/contrib/data/loader.py', license: 'MIT', paper: 'Qlib Alpha158 handler' },
  { id: 'rf', model: 'Random Forest', repo: 'scikit-learn/scikit-learn', file: 'sklearn/ensemble/_forest.py', license: 'BSD-3-Clause', paper: 'Breiman (2001)' },
  { id: 'extratrees', model: 'Extra Trees', repo: 'scikit-learn/scikit-learn', file: 'sklearn/ensemble/_forest.py', license: 'BSD-3-Clause', paper: 'Geurts et al. (2006)' },
  { id: 'elasticnet', model: 'Elastic Net', repo: 'scikit-learn/scikit-learn', file: 'sklearn/linear_model/_coordinate_descent.py', license: 'BSD-3-Clause', paper: 'Zou & Hastie (2005)' },
  { id: 'nb', model: 'Gaussian Naive Bayes', repo: 'scikit-learn/scikit-learn', file: 'sklearn/naive_bayes.py', license: 'BSD-3-Clause', paper: '' },
  { id: 'svm', model: 'Linear SVM (Pegasos)', repo: 'stefan-jansen/machine-learning-for-trading', file: 'ch. 12 / ch. 7 SVM notebooks', license: 'MIT', paper: 'Shalev-Shwartz et al. (2007)' },
  { id: 'dqn', model: 'DQN trading agent', repo: 'AI4Finance-Foundation/FinRL', file: 'finrl/agents (DQN)', license: 'MIT', paper: 'Mnih et al. (2015)' },
  { id: 'autograd', model: 'Reverse-mode autograd', repo: 'karpathy/micrograd', file: 'micrograd/engine.py', license: 'MIT', paper: '' },
  { id: 'hmm', model: 'Gaussian HMM', repo: 'hmmlearn/hmmlearn', file: 'hmmlearn/hmm.py, _emissions.py', license: 'BSD-3-Clause', paper: 'Rabiner (1989); Hamilton (1989)' },
  { id: 'kalman', model: 'Kalman dynamic hedge', repo: 'pykalman/pykalman', file: 'pykalman/standard.py', license: 'BSD', paper: 'Chan (2013), Algorithmic Trading' },
  { id: 'garch', model: 'GARCH(1,1)', repo: 'bashtage/arch', file: 'arch/univariate/volatility.py', license: 'NCSA', paper: 'Bollerslev (1986)' },
  { id: 'olmar', model: 'OLMAR', repo: 'Marigold/universal-portfolios', file: 'universal/algos/olmar.py', license: 'MIT', paper: 'Li & Hoi (2012)' },
  { id: 'meta', model: 'Triple barrier, meta-labeling, FFD, purged CV', repo: 'BlackArbsCEO/Adv_Fin_ML_Exercises', file: 'src/, notebooks ch. 3-7', license: 'MIT', paper: 'Lopez de Prado (2018), AFML' },
  { id: 'metrics', model: 'Tear-sheet metrics, IC analysis', repo: 'ranaroussi/quantstats; quantopian/alphalens', file: '', license: 'Apache-2.0', paper: '' },
];
})();
