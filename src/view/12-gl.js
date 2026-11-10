  // ---------------------------------------------------------------- 3D: the WebGL layer
  // A canvas under the 2D one, with a real depth buffer: what's nearer hides what's behind it, spheres are lit pixel by pixel and
  // know their own depth, and distance fades into fog. Plain WebGL2 and no library, which would add its weight to every release
  // in Sync's history. The 2D canvas stays on top for labels and rings; everything still goes through proj(), so what you click
  // is what you see. No WebGL (or a lost context): the views draw on the 2D canvas as before. A small pane or a card doesn't use it.
  const DEPTH_RANGE = 2600;   // world units in front of and behind the pivot that the depth buffer covers
  let glHome = 0;   // where fit() stood the camera: fog and depth are measured from there, so standing back doesn't fog everything
  const depth01 = z => Math.max(0, Math.min(1, (z + glHome + DEPTH_RANGE) / (2 * DEPTH_RANGE)));
  const glColor = (() => { const cache = new Map(); let g = null; return col => { let c = cache.get(col); if (c) return c; if (!g) { const e = document.createElement("canvas"); e.width = e.height = 1; g = e.getContext("2d", { willReadFrequently: true }); } g.clearRect(0, 0, 1, 1); g.fillStyle = "#000"; g.fillStyle = col; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; c = [d[0] / 255, d[1] / 255, d[2] / 255]; cache.set(col, c); return c; }; })();
  const GL = (() => {
    let gl = null, el = null, dead = false, tried = false, P = {}, quad = null, inst = null, lineBuf = null, mesh = null, drew = { sprites: 0, lines: 0, mesh: 0 }, bg = [0, 0, 0];
    const QUAD_VS = `#version 300 es
in vec2 c; in vec3 p; in float r; in vec4 col; in float kind; in float dr; uniform vec2 u_size; out vec2 uv; out vec4 v_col; flat out float v_kind; out float v_d; flat out float v_dr; uniform float u_pad; uniform float u_flat;
void main() { uv = c * u_pad; v_col = col; v_kind = kind; v_d = p.z; v_dr = dr; vec2 px = p.xy + vec2(uv.x, uv.y * (u_flat > 0.0 ? u_flat : 1.0)) * r; gl_Position = vec4(px.x / u_size.x * 2.0 - 1.0, 1.0 - px.y / u_size.y * 2.0, p.z * 2.0 - 1.0, 1.0); }`;
    const LIT_FS = `#version 300 es
precision highp float; in vec2 uv; in vec4 v_col; flat in float v_kind; in float v_d; flat in float v_dr; uniform vec3 u_light; uniform vec3 u_bg; uniform float u_dark; uniform float u_matte; out vec4 o;
float fog(float d) { return smoothstep(0.42, 0.72, d) * 0.72; }
void main() {
  float d2 = dot(uv, uv), a = v_col.a; vec3 col = v_col.rgb, N;
  if (v_kind < 0.5) { if (d2 > 1.0) discard; N = vec3(uv, -sqrt(1.0 - d2)); }                   // a note: a sphere
  else if (v_kind < 1.5) { float q = sqrt(d2); if (q > 1.0 || q < 0.72) discard; if (fract(atan(uv.y, uv.x) * 2.546) < 0.42) discard; N = vec3(uv, -0.5); a *= 0.8; }   // not written yet: a dashed, empty ring
  else if (v_kind < 2.5) { float q = abs(uv.x) + abs(uv.y) * 0.84; if (q > 1.0) discard; N = normalize(vec3(sign(uv.x) * 0.6, sign(uv.y) * 0.6, -0.8)); }            // a person: a cut stone
  else { float h = max(abs(uv.x) * 0.866 + abs(uv.y) * 0.5, abs(uv.y)); if (h > 0.96) discard; float rim = smoothstep(0.74, 0.8, h); N = normalize(vec3(uv * 0.5, -1.0)); a *= mix(0.42, 1.0, rim); col = mix(col * 0.75, col, rim); }   // a map: a hexagonal plate
  vec3 L = normalize(u_light), R = reflect(L, N); float diff = max(dot(N, L), 0.0), hemi = 0.5 - 0.5 * N.y, spec = pow(max(R.z, 0.0), 28.0), rimL = pow(1.0 - abs(N.z), 3.0);
  vec3 lit = col * (0.34 + 0.2 * hemi + 0.62 * diff) + vec3(1.0) * spec * 0.42 * (1.0 - 0.85 * u_matte) + col * rimL * (u_dark > 0.5 ? 0.55 : 0.12) * (1.0 - 0.8 * u_matte);   // matte: a printed model, not a glass bead
  lit = mix(lit, u_bg, fog(v_d)); o = vec4(lit * a, a); gl_FragDepth = clamp(v_d + N.z * v_dr, 0.0, 1.0);
}`;
    const GLOW_FS = `#version 300 es
precision highp float; in vec2 uv; in vec4 v_col; flat in float v_kind; in float v_d; uniform float u_add; out vec4 o;
void main() { float d2 = dot(uv, uv); if (d2 > 1.0) discard; float f = pow(1.0 - d2, v_kind > 0.5 ? 3.0 : 1.8) * v_col.a * (1.0 - smoothstep(0.5, 0.8, v_d) * 0.8); o = u_add > 0.5 ? vec4(v_col.rgb * f, 0.0) : vec4(v_col.rgb * f, f); }`;
    const LINE_VS = `#version 300 es
in vec2 c; in vec3 a; in vec3 b; in vec4 col; in float w; in float dash; uniform vec2 u_size; out vec4 v_col; out float v_u; out float v_d; out float v_len; flat out float v_dash;
void main() { vec2 d = b.xy - a.xy; float L = max(length(d), 0.001); vec2 n = vec2(-d.y, d.x) / L; vec2 px = mix(a.xy, b.xy, c.x) + n * c.y * (w + 1.0); float z = mix(a.z, b.z, c.x); v_col = col; v_u = c.y * (w + 1.0) / max(w * 0.5, 0.5); v_d = z; v_len = c.x * L; v_dash = dash; gl_Position = vec4(px.x / u_size.x * 2.0 - 1.0, 1.0 - px.y / u_size.y * 2.0, z * 2.0 - 1.0, 1.0); }`;
    const LINE_FS = `#version 300 es
precision highp float; in vec4 v_col; in float v_u; in float v_d; in float v_len; flat in float v_dash; uniform vec3 u_bg; uniform float u_add; out vec4 o;
void main() { if (v_dash > 0.0 && fract(v_len / v_dash) > 0.55) discard; float e = 1.0 - smoothstep(0.55, 1.0, abs(v_u)), f = smoothstep(0.42, 0.72, v_d), a = v_col.a * e * (1.0 - f * 0.82); o = u_add > 0.5 ? vec4(v_col.rgb * a, 0.0) : vec4(v_col.rgb * a, a); }`;
    const MESH_VS = `#version 300 es
in vec3 pos; in vec3 nor; in float fold; in float lobe; uniform vec2 u_size; uniform vec4 u_rot; uniform vec3 u_c; uniform vec4 u_cam; uniform float u_focal; uniform float u_range; uniform float u_home; out vec3 v_n; out float v_fold; flat out float v_lobe; out float v_d;
vec3 turn(vec3 q) { float x1 = q.x * u_rot.x + q.z * u_rot.y, z1 = -q.x * u_rot.y + q.z * u_rot.x; return vec3(x1, q.y * u_rot.z - z1 * u_rot.w, q.y * u_rot.w + z1 * u_rot.z); }
void main() { vec3 q = turn(pos - u_c); q.z -= u_cam.w; v_n = turn(nor); v_fold = fold; v_lobe = lobe; float den = u_focal + q.z, s = u_focal / max(den, 1.0); vec2 px = vec2(u_size.x * 0.5 + u_cam.y + q.x * s * u_cam.x, u_size.y * 0.5 + u_cam.z + q.y * s * u_cam.x); float d = (q.z + u_home + u_range) / (2.0 * u_range); v_d = d; gl_Position = vec4(px.x / u_size.x * 2.0 - 1.0, 1.0 - px.y / u_size.y * 2.0, den < 40.0 ? 2.0 : d * 2.0 - 1.0, 1.0); }`;
    const MESH_FS = `#version 300 es
precision highp float; in vec3 v_n; in float v_fold; flat in float v_lobe; in float v_d; uniform vec3 u_tint; uniform vec3 u_light; uniform float u_act[6]; uniform float u_pass; out vec4 o;
void main() { vec3 N = normalize(v_n); float facing = abs(N.z), fres = pow(1.0 - facing, 2.1), act = u_act[int(v_lobe + 0.5)], relief = 0.45 + 0.55 * max(dot(N, normalize(u_light)) * (N.z < 0.0 ? 1.0 : -1.0), 0.0), sulcus = mix(0.18, 1.0, smoothstep(0.08, 0.62, v_fold));
  float groove = 1.0 - smoothstep(0.12, 0.42, v_fold); vec3 c = mix(u_tint * (0.28 + 1.0 * relief) + vec3(1.0, 0.55, 0.3) * act * 0.25, u_tint * 0.05, groove); float a = (0.022 + fres * 0.17 + relief * relief * 0.07 + act * 0.03 + groove * 0.26) * (u_pass > 0.5 ? 1.0 : 0.35); a *= 1.0 - smoothstep(0.55, 0.8, v_d) * 0.5; o = vec4(c * a, a); }`;
    const TERRAIN_FS = `#version 300 es
precision highp float; in vec3 v_n; in float v_fold; flat in float v_lobe; in float v_d; uniform vec3 u_light; out vec4 o;
void main() { vec3 N = normalize(v_n); N = normalize(vec3(N.xy, -abs(N.z))); /* a slope past the line of sight shades on smoothly */ float v = clamp(v_fold, -1.0, 1.0), lit = 0.45 + 0.75 * max(dot(N, normalize(u_light)), 0.0), w = fwidth(v * 9.0), bar = 1.0 - smoothstep(0.0, 1.6 * w, abs(fract(v * 9.0 - 0.5) - 0.5));
  vec3 night = vec3(0.045, 0.075, 0.13), c = v < 0.0 ? mix(night, vec3(0.86, 0.22, 0.26), pow(-v, 1.1)) : mix(night, vec3(0.16, 0.42, 0.9), pow(v, 1.1)); c = c * lit + vec3(1.0) * bar * 0.13; c = mix(c, vec3(0.043, 0.07, 0.125), smoothstep(0.55, 0.8, v_d) * 0.7); o = vec4(c, 1.0); }`;
    const compile = (vs, fs, names, bound) => {
      const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; names.forEach(n => { u[n] = gl.getUniformLocation(p, n); }); const a = {}; bound.forEach(n => { a[n] = gl.getAttribLocation(p, n); }); return { p, u, a };
    };
    function init() {
      tried = true;
      try {
        if (typeof WebGL2RenderingContext === "undefined") return false;
        el = document.createElement("canvas"); el.className = "vg-gl"; el.setAttribute("aria-hidden", "true"); el.hidden = true; wrap.insertBefore(el, cv);
        gl = el.getContext("webgl2", { alpha: false, antialias: true, depth: true, powerPreference: "low-power" }); if (!gl) { el.remove(); el = null; return false; }
        el.addEventListener("webglcontextlost", e => { e.preventDefault(); dead = true; dirty = true; kick(); });
        el.addEventListener("webglcontextrestored", () => { dead = false; mesh = null; meshes.clear(); build(); dirty = true; kick(); });
        build(); return true;
      } catch (e) { console.warn("Vault Graph: no WebGL, drawing on the 2D canvas", e); if (el) el.remove(); el = null; gl = null; return false; }
    }
    function build() {
      const sprite = ["c", "p", "r", "col", "kind", "dr"], base = ["u_size", "u_pad", "u_flat"];
      P.lit = compile(QUAD_VS, LIT_FS, [...base, "u_light", "u_bg", "u_dark", "u_matte"], sprite); P.glow = compile(QUAD_VS, GLOW_FS, [...base, "u_add"], sprite);
      P.line = compile(LINE_VS, LINE_FS, ["u_size", "u_bg", "u_add"], ["c", "a", "b", "col", "w", "dash"]);
      P.mesh = compile(MESH_VS, MESH_FS, ["u_size", "u_rot", "u_c", "u_cam", "u_focal", "u_range", "u_home", "u_tint", "u_light", "u_act", "u_pass"], ["pos", "nor", "fold", "lobe"]);
      P.terrain = compile(MESH_VS, TERRAIN_FS, ["u_size", "u_rot", "u_c", "u_cam", "u_focal", "u_range", "u_home", "u_light"], ["pos", "nor", "fold", "lobe"]);
      quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      inst = gl.createBuffer(); lineBuf = gl.createBuffer(); P.lineQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, P.lineQuad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND);
    }
    const ok = () => !dead && (tried ? !!gl : init());
    const bindInst = (a, sizes, stride, offset = 0) => { let at = offset; for (const [name, n] of sizes) { const l = a[name]; if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, stride, at); gl.vertexAttribDivisor(l, 1); } at += n * 4; } };
    const SPRITE = [["p", 3], ["r", 1], ["col", 4], ["kind", 1], ["dr", 1]], STRIDE = 40;
    function sprites(prog, data, n, o = {}) {
      if (!n) return; const pr = prog === "lit" ? P.lit : P.glow; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_size, el.width / sizeScale, el.height / sizeScale); gl.uniform1f(pr.u.u_pad, 1); gl.uniform1f(pr.u.u_flat, o.flat || 0);
      if (prog === "lit") { gl.uniform3fv(pr.u.u_light, o.light); gl.uniform3fv(pr.u.u_bg, bg); gl.uniform1f(pr.u.u_dark, o.dark ? 1 : 0); gl.uniform1f(pr.u.u_matte, o.matte || 0); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true); }
      else { gl.uniform1f(pr.u.u_add, o.add ? 1 : 0); gl.blendFunc(gl.ONE, o.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); const c = pr.a.c; gl.enableVertexAttribArray(c); gl.vertexAttribPointer(c, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(c, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 10), gl.DYNAMIC_DRAW); bindInst(pr.a, SPRITE, STRIDE);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); drew.sprites += n;
    }
    function lines(data, n, o = {}) {
      if (!n) return; const pr = P.line; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_size, el.width / sizeScale, el.height / sizeScale); gl.uniform3fv(pr.u.u_bg, bg); gl.uniform1f(pr.u.u_add, o.add ? 1 : 0); gl.blendFunc(gl.ONE, o.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, P.lineQuad); gl.enableVertexAttribArray(pr.a.c); gl.vertexAttribPointer(pr.a.c, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(pr.a.c, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 12), gl.DYNAMIC_DRAW);
      let at = 0; for (const [name, k] of [["a", 3], ["b", 3], ["col", 4], ["w", 1], ["dash", 1]]) { const l = pr.a[name]; if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 48, at); gl.vertexAttribDivisor(l, 1); } at += k * 4; }
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); drew.lines += n;
    }
    // the brain's surface, built once. A grid over the sphere for each solid, with normals taken from its neighbours, so the folds catch the light
    function buildMesh(size) {
      const S = VGScience, solids = [], LAT = MOBILE ? 70 : 150, LON = LAT * 2;
      const solid = (lat, lon, at) => { const p = new Float32Array((lat + 1) * (lon + 1) * 3), f = new Float32Array((lat + 1) * (lon + 1)), l = new Float32Array((lat + 1) * (lon + 1)); for (let a = 0; a <= lat; a++) for (let b = 0; b <= lon; b++) { const th = Math.PI * a / lat, ph = 2 * Math.PI * b / lon, q = at(Math.sin(th) * Math.cos(ph), Math.cos(th) * -1, Math.sin(th) * Math.sin(ph)), i = a * (lon + 1) + b; p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; f[i] = q[3]; l[i] = q[4]; } solids.push({ p, f, l, lat, lon }); };
      const LOBES = { frontal: 0, parietal: 1, temporal: 2, occipital: 3 };
      solid(LAT, LON, (x, y, z) => { const c = S.cortexAt(x, y, z); return [x * c.r * size, y * c.r * size, z * c.r * size, c.fold, LOBES[c.lobe]]; });
      const C = S.CEREBELLUM; solid(LAT >> 1, LON >> 1, (x, y, z) => { const folia = Math.abs(Math.sin((y * C.ry + z * C.rz * 0.6) * 62)), bump = 1 + 0.018 * folia, m = 1 - 0.1 * Math.exp(-(x * x) / 0.006); return [(C.cx + x * C.rx * bump) * size, (C.cy + y * C.ry * bump * m) * size, (C.cz + z * C.rz * bump * m) * size, 0.15 + 0.85 * folia, 4]; });
      const B = S.STEM; solid(24, 32, (x, y, z) => [(B.cx + x * B.r * 0.85) * size, (B.cy + y * B.r * 2.1) * size, (B.cz + z * B.r * 0.9) * size, 0.7, 5]);
      let verts = 0, tris = 0; solids.forEach(s => { verts += (s.lat + 1) * (s.lon + 1); tris += s.lat * s.lon * 6; });
      const data = new Float32Array(verts * 8), index = new Uint32Array(tris); let v = 0, t = 0;
      for (const s of solids) { const W1 = s.lon + 1, pt = (a, b) => { const i = (Math.min(s.lat, Math.max(0, a)) * W1 + ((b + s.lon) % s.lon)) * 3; return [s.p[i], s.p[i + 1], s.p[i + 2]]; };
        for (let a = 0; a <= s.lat; a++) for (let b = 0; b <= s.lon; b++) { const i = a * W1 + b, A = pt(a + 1, b), B2 = pt(a - 1, b), C2 = pt(a, b + 1), D = pt(a, b - 1), u = [A[0] - B2[0], A[1] - B2[1], A[2] - B2[2]], w = [C2[0] - D[0], C2[1] - D[1], C2[2] - D[2]]; let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0], L = Math.hypot(nx, ny, nz) || 1; const o = (v + i) * 8; data[o] = s.p[i * 3]; data[o + 1] = s.p[i * 3 + 1]; data[o + 2] = s.p[i * 3 + 2]; data[o + 3] = nx / L; data[o + 4] = ny / L; data[o + 5] = nz / L; data[o + 6] = s.f[i]; data[o + 7] = s.l[i]; }
        for (let a = 0; a < s.lat; a++) for (let b = 0; b < s.lon; b++) { const i = v + a * W1 + b; index[t++] = i; index[t++] = i + W1; index[t++] = i + 1; index[t++] = i + 1; index[t++] = i + W1; index[t++] = i + W1 + 1; } v += (s.lat + 1) * W1; }
      const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
      mesh = { vbo, ibo, count: tris, size };
    }
    function brain(size, o) {
      if (!mesh || mesh.size !== size) buildMesh(size);
      const pr = P.mesh; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_size, el.width / sizeScale, el.height / sizeScale); gl.uniform4f(pr.u.u_rot, o.rot[0], o.rot[1], o.rot[2], o.rot[3]); gl.uniform3f(pr.u.u_c, cam.cx, cam.cy, cam.cz); gl.uniform4f(pr.u.u_cam, cam.k, cam.tx, cam.ty, cam.d || 0); gl.uniform1f(pr.u.u_focal, UI.size.focal); gl.uniform1f(pr.u.u_range, DEPTH_RANGE); gl.uniform1f(pr.u.u_home, glHome); gl.uniform3fv(pr.u.u_tint, o.tint); gl.uniform3fv(pr.u.u_light, o.light); gl.uniform1fv(pr.u.u_act, o.act); gl.uniform1f(pr.u.u_pass, o.front ? 1 : 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
      [["pos", 3, 0], ["nor", 3, 12], ["fold", 1, 24], ["lobe", 1, 28]].forEach(([n, k, off]) => { const l = pr.a[n]; if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(l, 0); } });
      gl.enable(gl.CULL_FACE); gl.cullFace(o.front ? gl.BACK : gl.FRONT); gl.frontFace(gl.CW); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0); gl.disable(gl.CULL_FACE); drew.mesh++;
    }
    // a height field: data is x, y, z, normal, value per point on a w by h grid, the value -1 to 1
    function field(key, build, o) {
      let m = meshes.get(key); if (!m) { for (const [, old] of meshes) { gl.deleteBuffer(old.vbo); gl.deleteBuffer(old.ibo); } meshes.clear(); const { data, w, h } = build(), index = new Uint32Array((w - 1) * (h - 1) * 6); let t = 0; for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i; index[t++] = a; index[t++] = a + w; index[t++] = a + 1; index[t++] = a + 1; index[t++] = a + w; index[t++] = a + w + 1; }
        m = { vbo: gl.createBuffer(), ibo: gl.createBuffer(), count: t }; gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW); meshes.set(key, m); }
      const pr = P.terrain; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_size, el.width / sizeScale, el.height / sizeScale); gl.uniform4f(pr.u.u_rot, o.rot[0], o.rot[1], o.rot[2], o.rot[3]); gl.uniform3f(pr.u.u_c, cam.cx, cam.cy, cam.cz); gl.uniform4f(pr.u.u_cam, cam.k, cam.tx, cam.ty, cam.d || 0); gl.uniform1f(pr.u.u_focal, UI.size.focal); gl.uniform1f(pr.u.u_range, DEPTH_RANGE); gl.uniform1f(pr.u.u_home, glHome); gl.uniform3fv(pr.u.u_light, o.light);
      gl.blendFunc(gl.ONE, gl.ZERO); gl.depthMask(true); gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      [["pos", 3, 0], ["nor", 3, 12], ["fold", 1, 24], ["lobe", 1, 28]].forEach(([n, k, off]) => { const l = pr.a[n]; if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, k, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(l, 0); } });
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); drew.mesh++;
    }
    const meshes = new Map();
    let sizeScale = 1;
    function begin(rgb, scale) {
      const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale)); sizeScale = scale; if (el.width !== w || el.height !== h) { el.width = w; el.height = h; el.style.width = W + "px"; el.style.height = H + "px"; }
      bg = rgb; gl.viewport(0, 0, w, h); gl.depthMask(true); gl.clearColor(rgb[0], rgb[1], rgb[2], 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); drew = { sprites: 0, lines: 0, mesh: 0 };
    }
    return { ok, begin, sprites, lines, brain, field, show(on) { if (el) el.hidden = !on; }, info: () => ({ ok: !!gl && !dead, ...drew, renderer: gl ? gl.getParameter(gl.VERSION) : null }), pixel(x, y) { const d = new Uint8Array(4); gl.readPixels(Math.round(x * sizeScale), el.height - 1 - Math.round(y * sizeScale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); return [...d]; }, flushRead() { gl.finish(); }, destroy() { if (gl) { const x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); } if (el) el.remove(); el = null; gl = null; } };
  })();
  // used where it pays: the 3D graph and the 3D brain, in a pane big enough to look at
  const glWanted = () => !opts.compact && !opts.embed && st.three && (st.view === "3d" || neural() || st.view === "weather" || !!(SCENES[st.view] && SCENES[st.view].gl));   // gl: true on a scene in space draws its solids here
  const glOn = () => glWanted() && GL.ok();

  // what the frame sends: grown as needed, and reused so a frame makes no garbage
  let glS = new Float32Array(10 * 2000), glSn = 0, glG = new Float32Array(10 * 2000), glGn = 0, glL = new Float32Array(12 * 6000), glLn = 0;
  const growS = () => { if ((glSn + 1) * 10 > glS.length) { const b = new Float32Array(glS.length * 2); b.set(glS); glS = b; } };
  const growG = () => { if ((glGn + 1) * 10 > glG.length) { const b = new Float32Array(glG.length * 2); b.set(glG); glG = b; } };
  const growL = () => { if ((glLn + 1) * 12 > glL.length) { const b = new Float32Array(glL.length * 2); b.set(glL); glL = b; } };
  function putSprite(x, y, d, r, c, a, kind, dr) { growS(); const o = glSn++ * 10; glS[o] = x; glS[o + 1] = y; glS[o + 2] = d; glS[o + 3] = r; glS[o + 4] = c[0]; glS[o + 5] = c[1]; glS[o + 6] = c[2]; glS[o + 7] = a; glS[o + 8] = kind; glS[o + 9] = dr; }
  function putGlow(x, y, d, r, c, a, tight) { growG(); const o = glGn++ * 10; glG[o] = x; glG[o + 1] = y; glG[o + 2] = d; glG[o + 3] = r; glG[o + 4] = c[0]; glG[o + 5] = c[1]; glG[o + 6] = c[2]; glG[o + 7] = a; glG[o + 8] = tight ? 1 : 0; glG[o + 9] = 0; }
  function putLine(a, b, c, al, w, dash) { growL(); const o = glLn++ * 12; glL[o] = a.x; glL[o + 1] = a.y; glL[o + 2] = depth01(a.depth); glL[o + 3] = b.x; glL[o + 4] = b.y; glL[o + 5] = depth01(b.depth); glL[o + 6] = c[0]; glL[o + 7] = c[1]; glL[o + 8] = c[2]; glL[o + 9] = al; glL[o + 10] = w; glL[o + 11] = dash || 0; }
  const glScale = () => Math.min(MOBILE ? 1.5 : 2, screenDpr());
  // the key light, fixed in the world: it stays put as you orbit, so highlights slide over the spheres the way they do on real ones
  function worldLight(R) { const x = -0.5, y = -0.9, z = -0.45, [cy, sy, cp, sp] = R, x1 = x * cy + z * sy, z1 = -x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp]; }
  const isDarkBg = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 0.5;
  // a note's look at this distance, shared with hit-testing: the size on screen and how much it shows
  function glLook(n, p, litSet, fd, shrink = 1) {
    const rel = Math.min(5, Math.pow(p.s / cam.k, 1.3) * 1.2), r = Math.min(MOBILE ? 46 : 70, Math.max(1.6, worldRadius(n) * shrink * Math.pow(cam.k, 0.8) * rel));
    let a = litSet && !litSet.has(n.id) ? 0.1 : 1; if (fd) a *= UI.focusAlpha[Math.min(fd.get(n.id) || 0, 4)];
    a *= 1 - Math.max(0, Math.min(1, (p.s / cam.k - 3.5) / 2)) * 0.9;   // passing the camera: it thins out instead of filling the screen
    return { r, a };
  }

  // ---- the 3D graph as a place: a floor with shadows under the notes, dust that gives parallax as you turn, and each topic's haze
  let dust = null, floorY = null;
  function dustField(rad) { if (dust && dust.rad === rad) return dust.list; const rand = VGScience.rng(23), list = []; for (let i = 0; i < (MOBILE ? 150 : 360); i++) { const u = rand() * 2 - 1, t = rand() * 6.283, q = Math.cbrt(rand()) * rad * 1.5, h = Math.sqrt(1 - u * u); list.push([Math.cos(t) * h * q, u * q, Math.sin(t) * h * q, rand()]); } dust = { rad, list }; return list; }
  function drawGraphGL(litSet, fd, accent) {
    const bgC = glColor(css("--vg-bg")), R = rot(), dark = isDarkBg(bgC), light = worldLight(R), scale = glScale(), fg = glColor(css("--vg-fg")), edge = glColor(css("--vg-edge")), gapC = glColor(css("--vg-gap")), simC = glColor(css("--vg-sim")), mut = glColor(css("--vg-muted"));
    GL.begin(bgC, scale); glSn = glGn = glLn = 0;
    let rad = 0, bottom = -Infinity; for (const n of active) { rad = Math.max(rad, Math.hypot(n.x - cam.cx, n.y - cam.cy, n.z - cam.cz)); bottom = Math.max(bottom, n.y); } rad = Math.max(120, rad); floorY = bottom + rad * 0.18;
    // the floor: a grid that fades with distance. From underneath it would hide nothing and explain nothing, so it goes.
    const above = proj(cam.cx, floorY, cam.cz, R), below = proj(cam.cx, floorY - 40, cam.cz, R), showFloor = above && below && above.y > below.y && Math.sin(-cam.pitch) > -0.02 && floorY > cam.cy;
    if (showFloor) { const step = Math.max(40, Math.round(rad / 10)), span = step * 14, gc = dark ? fg : mut, x0 = Math.round(cam.cx / step) * step, z0 = Math.round(cam.cz / step) * step;
      for (let i = -14; i <= 14; i++) { const major = i % 5 === 0; for (let j = -14; j < 14; j++) { const fade = Math.max(0, 1 - Math.hypot(i, j + 0.5) / 14), al = (major ? 0.14 : 0.06) * fade * fade; if (al < 0.004) continue; const a1 = proj(x0 + i * step, floorY, z0 + j * step, R), b1 = proj(x0 + i * step, floorY, z0 + (j + 1) * step, R), a2 = proj(x0 + j * step, floorY, z0 + i * step, R), b2 = proj(x0 + (j + 1) * step, floorY, z0 + i * step, R); if (a1 && b1) putLine(a1, b1, gc, al, 1); if (a2 && b2) putLine(a2, b2, gc, al, 1); } } void span; }
    GL.lines(glL, glLn, {}); glLn = 0;
    // shadows on the floor, under each note: nearer the floor, smaller and darker
    if (showFloor) { const squash = Math.max(0.12, Math.min(1, Math.abs(Math.sin(cam.pitch)))), sc = dark ? [0, 0, 0] : [0.1, 0.09, 0.08]; for (const n of active) { const p = proj(n.x + (n.y - floorY) * 0.25, floorY, n.z + (n.y - floorY) * 0.18, R); if (!p) continue; const h = (floorY - n.y) / (rad * 2), r = Math.max(2, worldRadius(n) * p.s * (1.5 + h * 1.6)); putGlow(p.x, p.y, depth01(p.depth), r, sc, (dark ? 0.5 : 0.28) * (1 - h * 0.55), false); }
      GL.sprites("glow", glG, glGn, { flat: squash, add: false }); glGn = 0; }
    // each topic's haze, behind its notes
    if (!fd) { const sum = {}; for (const n of active) { if (n.cluster < 0 || special(n)) continue; const g = sum[n.cluster] || (sum[n.cluster] = { x: 0, y: 0, z: 0, c: 0, r: 0 }); g.x += n.x; g.y += n.y; g.z += n.z; g.c++; }
      for (const n of active) { const g = sum[n.cluster]; if (g && !special(n)) g.r = Math.max(g.r, Math.hypot(n.x - g.x / g.c, n.y - g.y / g.c, n.z - g.z / g.c) * 0.5 + 0 * g.r); }
      for (const [c, g] of Object.entries(sum)) { if (g.c < 4) continue; const p = proj(g.x / g.c, g.y / g.c, g.z / g.c, R); if (p) putGlow(p.x, p.y, depth01(p.depth), Math.max(30, (g.r + 40) * p.s * 1.5), glColor(colorOf(+c)), (dark ? 0.03 : 0.05) * (litSet ? 0.3 : 1), false); }
      GL.sprites("glow", glG, glGn, { add: dark }); glGn = 0; }
    for (const q of dustField(rad)) { const p = proj(cam.cx + q[0], cam.cy + q[1], cam.cz + q[2], R); if (p) putGlow(p.x, p.y, depth01(p.depth), (1 + q[3] * 1.8) * Math.min(2.2, p.s / cam.k * 1.2), dark ? fg : mut, dark ? 0.22 + q[3] * 0.25 : 0.2, true); }
    GL.sprites("glow", glG, glGn, { add: dark }); glGn = 0;
    // links, depth-tested against nothing yet: they go under the notes that are drawn next, and fade with distance
    for (const l of visLinks) { const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue; const off = litSet && !(litSet.has(l.s.id) && litSet.has(l.t.id)), k = l.kind, c = k === "gap" ? gapC : k === "similar" ? simC : k === "link" ? edge : mut, al = off ? 0.05 : k === "link" ? 0.6 : VGRules.SUGGESTION_KINDS.has(k) ? (litSet ? 0.8 : 0.4) : k === "person" ? 0.2 : k === "moc" ? 0.14 : 0.35; putLine(a, b, c, al, k === "link" ? 1.2 : 1, VGRules.SUGGESTION_KINDS.has(k) ? 10 : k === "wanted" || k === "moc" ? 6 : 0); }
    GL.lines(glL, glLn, {}); glLn = 0;
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth), badges = [];
    for (const n of order) { const p = P.get(n.id), { r, a } = glLook(n, p, litSet, fd); p.r = r; p.a = a; if (a < 0.02) continue; putSprite(p.x, p.y, depth01(p.depth), r, glColor(fillOf(n)), a, n.ghost ? 1 : n.person ? 2 : n.moc ? 3 : 0, r / Math.max(0.01, p.s) / (2 * DEPTH_RANGE));
      if (st.layers.tasks && n.tasks > 0 && a > 0.3) { if (cam.k > 1.6 || st.selected === n.id || st.hover === n.id) badges.push([p.x + r * 0.8, p.y - r * 0.8, n.tasks]); else { ctx.globalAlpha = 0.9; ctx.fillStyle = css("--vg-task"); ctx.beginPath(); ctx.arc(p.x + r * 0.75, p.y - r * 0.75, 2.2, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1; } }
      if (st.selected === n.id || (st.multi && st.multi.has(n.id))) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, 2 * Math.PI); ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.stroke(); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1; }
      else if (overlayHit(n) && a > 0.5) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = css("--vg-fg"); ctx.stroke(); } }
    GL.sprites("lit", glS, glSn, { light, dark }); glSn = 0;
    return { order, badges };
  }

  // ---- Weather in 3D: the pressure field as ground, a low a valley and a high a hill, so the slope you see is what drives the wind
  const WEATHER_RELIEF = 48;
  function drawWeatherGL(Wd, R) {
    GL.begin([0.043, 0.07, 0.125], glScale());
    GL.field(Wd, () => { const { E, gw: w, gh: h, CELL, x0, y0 } = Wd, top = Math.max(0.3, ...E.map(Math.abs)), data = new Float32Array(w * h * 8); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i, o = k * 8, dx = -(E[j * w + Math.min(w - 1, i + 1)] - E[j * w + Math.max(0, i - 1)]) * WEATHER_RELIEF, dy = -(E[Math.min(h - 1, j + 1) * w + i] - E[Math.max(0, j - 1) * w + i]) * WEATHER_RELIEF, nz = 2 * CELL, L = Math.hypot(dx, dy, nz); data[o] = x0 + i * CELL; data[o + 1] = y0 + j * CELL; data[o + 2] = -E[k] * WEATHER_RELIEF;   /* z runs away from the camera: low pressure sinks */ data[o + 3] = dx / L; data[o + 4] = dy / L; data[o + 5] = -nz / L; data[o + 6] = E[k] / top; data[o + 7] = 0; } return { data, w, h }; }, { rot: R, light: worldLight(R) });
  }
  // ---- the brain: real anatomy and a real neuron model. See src/science.js for both and tests/test_science.js for what holds them.
  // The network: each note a neuron, each link a synapse. Spikes take the time the axon takes: 300 units is the brain's 84 mm half
  // length, and conduction is 3 m/s short range, up to 12 m/s for the long myelinated tracts. Slowed 25 times so you can follow one.
  const NEURO_SLOW = 25, NEURO_STEP = 0.25, NEURO_BASE = 0.26, MM_PER_UNIT = 84 / (BRAIN_SIZE), NEURO_MAX_SHOWN = MOBILE ? 150 : 500;
  let neuro = null, neuroFor = null, neuroSpikes = [], lastNeuro = 0;
  const conduction = mm => Math.min(12, 3 + mm * 0.18);   // m/s, the same as mm per ms
  function neuroNet() {
    if (neuro && neuroFor === visLinks) return neuro;
    const list = active.filter(n => !special(n)), g = VGScience.graphOf(list.map(n => n.id), visLinks.filter(l => l.kind === "link").map(l => [l.s.id, l.t.id]));
    const delay = (i, j) => { const a = byId[g.ids[i]], b = byId[g.ids[j]], mm = Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0), (a.z || 0) - (b.z || 0)) * MM_PER_UNIT; return mm / conduction(mm) + 0.5; };
    const net = VGScience.lifNetwork(g, { delay, seed: 17 });
    // background input from the rest of the brain: under what makes a cell fire alone, more for a note you've been working in. Set so the network sits at a few hertz, as cortex does
    neuro = { g, net, list, rate: list.map(n => NEURO_BASE + 0.2 * activity(n)), start: 0 }; neuroFor = visLinks; neuroSpikes = []; return neuro;
  }
  // a tract's route: within a hemisphere it dips under the cortex; between hemispheres it crosses at the corpus callosum, above the thalamus
  function tractBend(a, b, out) { const crosses = (a.x || 0) * (b.x || 0) < 0; if (crosses) { out[0] = 0; out[1] = -0.14 * BRAIN_SIZE; out[2] = ((a.z || 0) + (b.z || 0)) * 0.3; } else { const u = 0.58; out[0] = ((a.x || 0) + (b.x || 0)) * 0.5 * u; out[1] = ((a.y || 0) + (b.y || 0)) * 0.5 * u; out[2] = ((a.z || 0) + (b.z || 0)) * 0.5 * u; } }
  const bez = (a, c, b, t) => { const u = 1 - t; return [u * u * (a.x || 0) + 2 * u * t * c[0] + t * t * (b.x || 0), u * u * (a.y || 0) + 2 * u * t * c[1] + t * t * (b.y || 0), u * u * (a.z || 0) + 2 * u * t * c[2] + t * t * (b.z || 0)]; };
  function drawBrainGL(now, litSet, fd) {
    const R = rot(), rotU = [R[0], R[1], R[2], R[3]], light = worldLight(R), scale = glScale(), night = st.vision === "nv" ? [0.004, 0.03, 0.012] : st.vision === "thermal" ? [0.02, 0.012, 0.05] : [0.008, 0.024, 0.055], tint = st.vision === "nv" ? [0.26, 0.86, 0.5] : st.vision === "thermal" ? [0.85, 0.42, 0.55] : [0.5, 0.72, 0.95];
    GL.begin(night, scale); glSn = glGn = glLn = 0;
    const lobes = [0, 0, 0, 0, 0, 0]; { const sums = {}; for (const c in lobeStats) { const L = neuralLobes[c]; if (L == null) continue; (sums[L] = sums[L] || []).push(lobeStats[c].act); } Object.entries(sums).forEach(([L, a]) => { lobes[L] = Math.min(1, a.reduce((x, y) => x + y, 0) / a.length * 2); }); }
    const M = { rot: rotU, tint, light, act: lobes };
    GL.brain(BRAIN_SIZE, { ...M, front: false });
    // the simulation runs on the time that actually passed, slowed; it stands still with reduced motion
    const N = neuroNet(); let shown = [];
    if (!reducedMotion() && !morph) { const dtReal = Math.min(80, now - (lastNeuro || now)); lastNeuro = now; const dt = dtReal / NEURO_SLOW; if (dt > 0) { const boost = st.selected || st.hover, around = boost && st.focusDist ? st.focusDist : null;
      // small steps, whatever the frame rate: background input arrives as chance events, and a step long enough to make that chance reach 100% would turn it into a steady drip that never fires anything
      const steps = Math.max(1, Math.ceil(dt / NEURO_STEP)), h = dt / steps;
      for (let k = 0; k < steps; k++) for (const f of N.net.step(h, i => (N.rate[i] + ((N.list[i].id === st.selected || N.list[i].id === st.hover) ? 0.4 : around && around.has(N.list[i].id) ? 0.12 : 0)) * h)) { const a = N.list[f.i]; a._spike = now; for (const t of f.to) if (neuroSpikes.length < NEURO_MAX_SHOWN) neuroSpikes.push({ a, b: N.list[t.j], t0: f.t, t1: t.arrive, inhib: f.inhib }); } } }
    else lastNeuro = now;
    const simNow = N.net.time(); shown = neuroSpikes = neuroSpikes.filter(s => s.t1 > simNow);
    // white matter: curved tracts, faint unless you've picked something
    const segs = MOBILE ? 3 : 6, bend = [0, 0, 0], c0 = [0, 0, 0];
    for (const l of visLinks) { const A = P.get(l.s.id), B = P.get(l.t.id); if (!A || !B) continue; const on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id)); if (litSet && !on) continue; const col = l.kind === "link" ? glColor(fillOf(l.s.cluster >= 0 ? l.s : l.t)) : l.kind === "gap" ? glColor("#fb7185") : l.kind === "similar" ? glColor("#c084fc") : glColor("#94a3b8"), al = litSet ? 0.5 : l.kind === "link" ? 0.13 : 0.16; c0[0] = col[0]; c0[1] = col[1]; c0[2] = col[2]; tractBend(l.s, l.t, bend); let prev = A; for (let i = 1; i <= segs; i++) { const q = i === segs ? [l.t.x, l.t.y, l.t.z] : bez(l.s, bend, l.t, i / segs), p = i === segs ? B : proj(q[0], q[1], q[2], R); if (!p) { prev = null; continue; } if (prev) putLine(prev, p, c0, al, 0.9, l.kind === "link" ? 0 : 7); prev = p; } }
    GL.lines(glL, glLn, { add: true }); glLn = 0;
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth);
    for (const n of order) { const p = P.get(n.id), { r, a } = glLook(n, p, litSet, fd, 0.62); p.r = r; p.a = a; if (a < 0.02) continue; const col = glColor(fillOf(n)), flash = n._spike ? Math.max(0, 1 - (now - n._spike) / 420) : 0, d = depth01(p.depth);
      putSprite(p.x, p.y, d, r, flash > 0 ? [col[0] + (1 - col[0]) * flash, col[1] + (1 - col[1]) * flash, col[2] + (1 - col[2]) * flash] : col, a, n.ghost ? 1 : n.person ? 2 : n.moc ? 3 : 0, r / Math.max(0.01, p.s) / (2 * DEPTH_RANGE)); if (!n.ghost) putGlow(p.x, p.y, d, r * (2.6 + flash * 3), col, a * (0.32 + flash * 0.75), false); }
    GL.sprites("lit", glS, glSn, { light, dark: true }); glSn = 0;
    // action potentials on their way: excitatory in the note's colour, inhibitory cold blue
    for (const s of shown) { if (litSet && !(litSet.has(s.a.id) && litSet.has(s.b.id))) continue; tractBend(s.a, s.b, bend); const u = Math.max(0, Math.min(1, (simNow - s.t0) / Math.max(0.01, s.t1 - s.t0))), q = bez(s.a, bend, s.b, u), p = proj(q[0], q[1], q[2], R); if (!p) continue; const d = depth01(p.depth), c = s.inhib ? [0.42, 0.72, 1] : glColor(fillOf(s.a)); putGlow(p.x, p.y, d, 5.5 * Math.min(1.8, p.s / cam.k), c, 0.85, false); putGlow(p.x, p.y, d, 1.8 * Math.min(1.8, p.s / cam.k), [1, 1, 1], 0.95, true); }
    GL.sprites("glow", glG, glGn, { add: true }); glGn = 0;
    GL.brain(BRAIN_SIZE, { ...M, front: true });
    return order;
  }
  // How to read this, for every view that shows real results in a picture: what each mark and number means, one click away
  const VIEW_HELP = {
    neural: [["Nodes, links, lobes, maps, bridges", "What's on screen: notes, people and notes to write; the links between notes; your topics; your map notes; and notes that join two topics."], ["Hz", "The firing rate, measured live in 3D: spikes per note, per simulated second. Real cortex runs at a few hertz. A note you've worked on lately gets more input, so it fires more."], ["LIF network", "Each note is a model neuron and each link a synapse. A neuron charges up, fires at a threshold, then resets (leaky integrate-and-fire). The spikes come from that model, not from your edits one by one."], ["80/20 E/I", "80% of cells excite the cells they link to and 20% inhibit them, as in real cortex. Spikes in a note's colour excite. Pale blue spikes inhibit."], ["×1/25 speed", "Slowed 25 times so you can follow a spike along a link. Long links carry faster, as long nerve fibres do."], ["Shape", "Proportions and lobes are a real brain's, and lobes hold topics in their real shares of cortex. Which lobe a topic lands in means nothing about the topic. The notes in the centre, in the thalamus, are the ones that connect most. Notes with no topic sit in the cerebellum."], ["Links", "Curves under the surface. Links between the two halves cross in the middle, at the corpus callosum."], ["Under each topic", "Its notes, how many you touched this week, and the share gone stale."]],
    foodweb: [["Height", "A note's trophic level (MacKay, Johnson & Sansom). A note feeds on what it links to, and each note gets the height that makes its links climb by as close to one level as they can. High notes rest on chains of others; low ones are what the rest stands on."], ["Mean level, top", "The average height of notes that link to something, and the highest in the web. Longer chains mean more rests on more."], ["Incoherence", "How far the links are from a clean climb. 0 is a true hierarchy, every link up exactly one level. 1 is no direction at all, as in links that go round in circles."], ["Connectance", "The share of all possible links that exist. Real food webs run about 3 to 30%; a vault is far sparser, since it has many more species."], ["Sparks", "Energy climbing from a note to what links to it. Grey sparks start from a stale note, and turn what they reach grey for a while: out-of-date knowledge moving up the chain."], ["Red rings", "Stale notes that at least four others link to: if they're wrong, a lot rests on them."]],
    weather: [["Pressure", "Each topic's anomaly: how much more or less your dailies mention it lately than usual. L is busier than usual, H quieter. Only the shape is real: there's no millibar reading behind it."], ["Isobars", "Lines of equal pressure. Closer lines mean a sharper change between neighbouring topics. In 3D the same field is ground: a low is a valley, a high a hill."], ["Wind", "Follows real surface wind: along the isobars, counter-clockwise round a low and clockwise round a high, leaning 25 degrees in towards the low (Buys Ballot's law)."], ["Fronts", "Two topics that keep coming up together. Red with half-moons: both heating up. Blue with triangles: one heating, one cooling. Both: neither stands out."], ["Storm", "A topic whose latest week is at least 2.5 times its usual, with at least 4 mentions."]],
    cosmos: [["Orbits", "Real Newtonian gravity: notes linked to a star orbit it, as true ellipses, and Kepler's laws hold. Further out takes longer."], ["Stars, planets, black holes", "You place these. A star takes a note and what it links to; a planet takes the matches of a search; a black hole pulls in what's stale; a repulsor pushes notes away."], ["Nebula, belt, comets", "The nebula is unlinked notes. The belt is notes to write. Comets are notes from recent dailies, on long ellipses."], ["Figures", "Pick a body for its mass, orbit distance a, shape e and lap time."]],
    subway: [["Lines", "Each topic is a line."], ["Stations", "Notes. A black ring is an interchange: a note connecting topics. The busier the note, the bigger the station."]],
    clock: [["The rings", "When each topic comes up in your dailies, by weekday and by month. Hotter means more mentions then. A count of mentions, not hours worked."]],
    radar: [["Blips", "Notes with open tasks. The nearer the centre, the longer its oldest task has waited."], ["Next step", "Click a blip to tick its tasks off."]],
    "3d": [["Moving", "Drag to orbit; the wheel flies in and out, so near notes pass you and far ones barely move."], ["Size", "How many routes between other notes run through it."], ["Floor", "Shadows sit under the notes and show how high each one is. The height itself comes from the layout: linked notes pull together, and it has no meaning of its own."]],
  };
  function syncViewHelp() { const b = $(".vg-viewhelp"), c = $(".vg-viewcard"), help = !opts.compact && !isGame() && VIEW_HELP[st.view]; b.hidden = !help; if (c.dataset.view !== st.view) { c.hidden = true; b.setAttribute("aria-expanded", "false"); c.dataset.view = st.view; c.innerHTML = help ? `<dl>${help.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}</dl>` : ""; } }
  { const b = $(".vg-viewhelp"), c = $(".vg-viewcard"); b.onclick = e => { e.stopPropagation(); c.hidden = !c.hidden; b.setAttribute("aria-expanded", String(!c.hidden)); }; }
  const neuroRate = () => { if (!neuro || !neuro.net.time()) return 0; return neuro.net.total() / Math.max(1, neuro.list.length) / (neuro.net.time() / 1000); };
