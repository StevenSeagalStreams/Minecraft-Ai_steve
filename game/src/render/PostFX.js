import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * The grade pass. This is where the game gets its face.
 *
 * The chain renders scene-referred HDR, so bloom can threshold on real
 * radiance (only emissive fire and spell cores exceed 1.0) rather than on
 * arbitrary bright pixels. This pass then does the display transform:
 *
 *   exposure -> ACES filmic -> lift/gamma/gain -> shadow tint -> saturation
 *   -> vignette -> chromatic aberration -> film grain
 *
 * Output stays linear; OutputPass owns the sRGB encode.
 */
const GradeShader = {
  uniforms: {
    tDiffuse:        { value: null },
    exposure:        { value: 1.30 },
    contrast:        { value: 1.06 },
    saturation:      { value: 1.02 },
    lift:            { value: new THREE.Vector3(0.008, 0.010, 0.018) },
    gain:            { value: new THREE.Vector3(1.02, 1.00, 0.96) },
    shadowTint:      { value: new THREE.Vector3(0.28, 0.38, 0.62) },
    shadowTintAmt:   { value: 0.16 },
    highlightTint:   { value: new THREE.Vector3(1.00, 0.86, 0.62) },
    highlightAmt:    { value: 0.10 },
    vignette:        { value: 0.62 },
    vignetteSoft:    { value: 0.52 },
    aberration:      { value: 0.0016 },
    grain:           { value: 0.032 },
    time:            { value: 0 },
    resolution:      { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float exposure, contrast, saturation;
    uniform vec3  lift, gain, shadowTint, highlightTint;
    uniform float shadowTintAmt, highlightAmt;
    uniform float vignette, vignetteSoft, aberration, grain, time;
    uniform vec2  resolution;
    varying vec2 vUv;

    // ACES filmic tone mapping, Stephen Hill's fit of the RRT+ODT.
    const mat3 ACESInput = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutput = mat3(
       1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602
    );

    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }

    vec3 ACESFitted(vec3 color) {
      color = ACESInput * color;
      color = RRTAndODTFit(color);
      color = ACESOutput * color;
      return clamp(color, 0.0, 1.0);
    }

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // Interleaved-gradient noise: cheap, temporally stable per-frame, and it
    // dithers banding in the dark falloff of torchlight where 8-bit output
    // would otherwise show rings.
    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);

      // Lateral chromatic aberration: scales with radius, so the frame centre
      // stays clean and only the extreme edges fringe.
      vec3 color;
      if (aberration > 0.0) {
        vec2 dir = center * aberration * (0.35 + r2 * 2.4);
        color.r = texture2D(tDiffuse, uv + dir).r;
        color.g = texture2D(tDiffuse, uv).g;
        color.b = texture2D(tDiffuse, uv - dir).b;
      } else {
        color = texture2D(tDiffuse, uv).rgb;
      }

      color *= exposure;
      color = ACESFitted(color);

      // lift / gain, then contrast pivoted at mid grey
      color = color * gain + lift * (1.0 - color);
      color = (color - 0.18) * contrast + 0.18;
      color = max(color, 0.0);

      // split tone: cool the shadows, warm the highlights. This single step
      // does more for the gothic mood than any amount of texture detail.
      float l = luma(color);
      float sMask = pow(1.0 - clamp(l * 1.6, 0.0, 1.0), 2.0);
      float hMask = pow(clamp(l * 1.25 - 0.25, 0.0, 1.0), 1.5);
      color = mix(color, color * shadowTint * 2.0, sMask * shadowTintAmt);
      color = mix(color, color * highlightTint, hMask * highlightAmt);

      color = mix(vec3(luma(color)), color, saturation);

      // vignette
      float v = smoothstep(vignette, vignette - vignetteSoft, sqrt(r2));
      color *= mix(1.0, v, 0.85);

      // film grain, scaled down in highlights the way real emulsion behaves
      float n = ign(gl_FragCoord.xy + fract(time * 60.0) * 137.0) - 0.5;
      color += n * grain * (0.35 + 0.65 * (1.0 - luma(color)));

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // --- ambient occlusion -------------------------------------------------
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({
      radius: 0.55,
      distanceExponent: 1.4,
      thickness: 0.6,
      scale: 1.0,
      samples: 16,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    this.gtao.enabled = quality.ssao !== false;
    this.composer.addPass(this.gtao);

    // --- bloom -------------------------------------------------------------
    // threshold > 1.0 makes this physically selective: only emitters that
    // actually exceed white (fire, spell cores, hot metal) bloom.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.62, 0.72, 1.05);
    this.bloom.enabled = quality.bloom !== false;
    this.composer.addPass(this.bloom);

    // --- grade -------------------------------------------------------------
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.resolution.value.set(size.x, size.y);
    if (quality.grain === false) this.grade.uniforms.grain.value = 0;
    this.composer.addPass(this.grade);

    this.output = new OutputPass();
    this.composer.addPass(this.output);

    this.smaa = new SMAAPass(size.x, size.y);
    this.composer.addPass(this.smaa);

    this._time = 0;
  }

  /** Push transient looks: hit flashes, low-health desaturation, level intros. */
  setExposure(v) { this.grade.uniforms.exposure.value = v; }
  setSaturation(v) { this.grade.uniforms.saturation.value = v; }
  setVignette(v) { this.grade.uniforms.vignette.value = v; }

  update(dt) {
    this._time += dt;
    this.grade.uniforms.time.value = this._time;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.gtao.setSize(w, h);
    this.bloom.setSize(w, h);
    this.smaa.setSize(w, h);
    this.grade.uniforms.resolution.value.set(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
