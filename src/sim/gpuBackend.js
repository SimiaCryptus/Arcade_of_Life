import {CELL_TYPE} from '../config.js';
import {Logger} from '../logger.js';

/**
 * GPU simulation backend using WebGL2.
 *
 * Computes neighbor counts on the GPU by uploading the grid as a texture
 * and rendering a fragment shader that samples the 3x3 Moore neighborhood.
 * Output is read back to CPU for the orchestrator to apply custom rules.
 *
 * Note: full GoL on GPU would eliminate the readback, but the game's
 * custom rules (collisions, age, return-fire) require per-tick CPU work
 * anyway. The GPU path is a net win when neighbor-counting dominates
 * (grids >= 200x200) even with readback overhead.
 */
export class GpuSimBackend {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.canvas = canvas;

    this._initShaders();
    this._initBuffers();
    this._initTextures();
    this._readback = new Uint8Array(width * height * 4);
  }

  _initShaders() {
    const gl = this.gl;
    const vs = `#version 300 es
          in vec2 a_pos;
          out vec2 v_uv;
          void main() {
            v_uv = a_pos * 0.5 + 0.5;
            gl_Position = vec4(a_pos, 0.0, 1.0);
          }`;
    // Fragment shader: read 3x3 neighborhood, classify each cell as
    // missile/defense/other, emit counts in RGBA channels:
    //   R = life count (missile+defense)
    //   G = missile count
    //   B = defense count
    //   A = own cell type (preserved for fast CPU lookup)
    // Cell types encoded as integers 0..4 in the input texture's R channel.
    // We use a UINT texture so values are exact.
    const fs = `#version 300 es
          precision highp float;
          precision highp int;
          precision highp usampler2D;
          in vec2 v_uv;
          uniform usampler2D u_grid;
          uniform ivec2 u_size;
          out uvec4 outColor;
          void main() {
            ivec2 coord = ivec2(gl_FragCoord.xy);
            int w = u_size.x;
            int h = u_size.y;
            uint life = 0u;
            uint miss = 0u;
            uint def = 0u;
            for (int dy = -1; dy <= 1; dy++) {
              int ny = coord.y + dy;
              if (ny < 0 || ny >= h) continue;
              for (int dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) continue;
                int nx = (coord.x + dx + w) % w;  // horizontal wrap
                uint t = texelFetch(u_grid, ivec2(nx, ny), 0).r;
                if (t == 2u) { life++; miss++; }
                else if (t == 1u) { life++; def++; }
              }
            }
            uint own = texelFetch(u_grid, coord, 0).r;
            outColor = uvec4(life, miss, def, own);
          }`;
    this.program = this._link(vs, fs);
    this.u_grid = gl.getUniformLocation(this.program, 'u_grid');
    this.u_size = gl.getUniformLocation(this.program, 'u_size');
  }

  _link(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('VS compile: ' + gl.getShaderInfoLog(vs));
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('FS compile: ' + gl.getShaderInfoLog(fs));
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  _initBuffers() {
    const gl = this.gl;
    // Full-screen quad.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
  }

  _initTextures() {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    // Input texture: R8UI, one channel = cell type.
    this.texInput = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texInput);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, w, h);

    // Output texture: RGBA8UI, R=life, G=miss, B=def, A=own.
    this.texOutput = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texOutput);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, w, h);

    // FBO for rendering into output texture.
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, this.texOutput, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('FBO incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  computeNeighborCounts(cells, w, h, lifeOut, missOut, defOut) {
    const gl = this.gl;
    // Upload grid as R8UI texture.
    gl.bindTexture(gl.TEXTURE_2D, this.texInput);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h,
      gl.RED_INTEGER, gl.UNSIGNED_BYTE, cells);

    // Render neighbor counts into output FBO.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texInput);
    gl.uniform1i(this.u_grid, 0);
    gl.uniform2i(this.u_size, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Readback (the unavoidable bottleneck — but it's a single pass).
    gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, this._readback);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Demultiplex RGBA into the three output arrays.
    const rb = this._readback;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      lifeOut[i] = rb[j];
      missOut[i] = rb[j + 1];
      defOut[i] = rb[j + 2];
    }
  }

  destroy() {
    const gl = this.gl;
    if (this.texInput) gl.deleteTexture(this.texInput);
    if (this.texOutput) gl.deleteTexture(this.texOutput);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
  }
}
