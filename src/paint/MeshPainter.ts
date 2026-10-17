import * as THREE from 'three';

/**
 * Проєкційне малювання по 3D-моделі (як у Substance Painter).
 *
 * Принцип роботи:
 * - Кожен матеріал отримує власний render target (шар фарби) у UV-просторі моделі.
 * - Мазок — це коло на ЕКРАНІ. Модель рендериться "розгорнутою" в UV (gl_Position = uv),
 *   а у фрагментному шейдері світова позиція проєктується назад на екран, і якщо
 *   фрагмент потрапив у коло кисті — він фарбується. Тому товщина мазка однакова
 *   на екрані на будь-якій грані й під будь-яким кутом.
 * - Видимість: перед мазком рендериться карта глибини з камери. Фрагменти, що лежать
 *   за видимою поверхнею (зворотна сторона, інші деталі), не фарбуються.
 * - Після мазка UV-острівці розширюються на кілька текселів (padding), щоб на швах
 *   не було світлих ліній при білінійній фільтрації та міпмапах.
 */

/** Максимум відбитків кисті за один виклик відмальовування */
export const MAX_STAMPS = 32;

/** Розмір текстури шару фарби */
const TEXTURE_SIZE = 2048;

/** Кількість проходів padding (парна, бо ping-pong між двома targets) */
const PADDING_PASSES = 4;

const STAMP_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vNormalW = mat3(modelMatrix) * normal;
    // Розгортаємо модель у UV-простір: піксель target = тексель текстури
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const STAMP_FRAG = /* glsl */ `
  #define MAX_STAMPS ${MAX_STAMPS}

  uniform vec2 uCenters[MAX_STAMPS];
  uniform int uCount;
  uniform float uRadius;
  uniform float uHardness;
  uniform float uNear;
  uniform float uFar;
  uniform float uModelSize;
  uniform vec2 uResolution;
  uniform mat4 uViewProj;
  uniform vec3 uCameraPos;
  uniform vec3 uColor;
  uniform sampler2D uDepth;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  float linearizeDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }

  void main() {
    // Проєктуємо точку поверхні на екран
    vec4 clip = uViewProj * vec4(vWorldPos, 1.0);
    if (clip.w <= 0.0) discard;
    vec3 ndc = clip.xyz / clip.w;
    if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) discard;

    vec2 screenUv = ndc.xy * 0.5 + 0.5;
    vec2 px = screenUv * uResolution;

    // Покриття кистю: максимум по всіх відбитках (щоб перекриття не накопичувалось)
    float a = 0.0;
    for (int i = 0; i < MAX_STAMPS; i++) {
      if (i >= uCount) break;
      float d = distance(px, uCenters[i]);
      a = max(a, 1.0 - smoothstep(uRadius * uHardness, uRadius, d));
    }
    if (a <= 0.0) discard;

    // Видимість: фарбуємо лише те, що видно з камери
    float fragLin = linearizeDepth(ndc.z * 0.5 + 0.5);
    float sceneLin = linearizeDepth(texture2D(uDepth, screenUv).x);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float facing = max(abs(dot(normalize(vNormalW), viewDir)), 0.2);
    float bias = (0.003 * sceneLin + 0.0007 * uModelSize) / facing;
    if (fragLin > sceneLin + bias) discard;

    gl_FragColor = vec4(uColor, a);
  }
`;

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const BAKE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform bool uHasMap;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec4 t = uHasMap ? texture2D(uMap, vUv) : vec4(1.0);
    gl_FragColor = vec4(uColor * t.rgb, 1.0);
  }
`;

const FULLSCREEN_VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// alpha = 1 — справжній піксель острівця, 0.5 — padding, 0 — порожньо
const DILATE_FRAG = /* glsl */ `
  uniform sampler2D uSrc;
  uniform float uMinAlpha;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 maxP = textureSize(uSrc, 0) - ivec2(1);
    vec4 c = texelFetch(uSrc, p, 0);
    if (c.a > uMinAlpha) {
      gl_FragColor = c;
      return;
    }
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) continue;
        ivec2 q = clamp(p + ivec2(dx, dy), ivec2(0), maxP);
        vec4 n = texelFetch(uSrc, q, 0);
        if (n.a > uMinAlpha) {
          gl_FragColor = vec4(n.rgb, 0.5);
          return;
        }
      }
    }
    gl_FragColor = vec4(0.0);
  }
`;

type PaintableMaterial = THREE.Material & {
  map: THREE.Texture | null;
  color: THREE.Color;
};

function isPaintable(material: THREE.Material): material is PaintableMaterial {
  return 'color' in material && 'map' in material;
}

interface ProxyEntry {
  /** Допоміжний меш, що ділить геометрію з оригіналом, але рендериться шейдером мазка */
  mesh: THREE.Mesh;
  source: THREE.Mesh;
  /** Індекс матеріалу в масиві (для мешів з кількома матеріалами) */
  slot: number;
  /** 0 — у меша один матеріал, інакше довжина масиву матеріалів */
  slotCount: number;
}

interface Layer {
  material: PaintableMaterial;
  target: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  proxies: ProxyEntry[];
  dirty: boolean;
}

export interface PaintRequest {
  /** Основна сцена (потрібна для карти глибини) */
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Центри відбитків у пікселях drawing buffer, початок координат — лівий нижній кут */
  points: Array<{ x: number; y: number }>;
  /** Радіус кисті в пікселях drawing buffer */
  radiusPx: number;
  /** 0..1 — частка радіуса з повною непрозорістю (далі м'який край) */
  hardness: number;
  /** Колір кисті */
  color: THREE.Color;
  /** Найбільший розмір моделі (для допусків при перевірці видимості) */
  modelSize: number;
}

export class MeshPainter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly layers = new Map<THREE.Material, Layer>();
  private preparedModel: THREE.Object3D | null = null;

  private readonly centers: THREE.Vector2[] = Array.from(
    { length: MAX_STAMPS },
    () => new THREE.Vector2()
  );

  private readonly stampUniforms = {
    uCenters: { value: this.centers },
    uCount: { value: 0 },
    uRadius: { value: 10 },
    uHardness: { value: 0.8 },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uModelSize: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uViewProj: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color() },
    uDepth: { value: null as THREE.Texture | null },
  };

  private readonly bakeUniforms = {
    uMap: { value: null as THREE.Texture | null },
    uHasMap: { value: false },
    uColor: { value: new THREE.Color(1, 1, 1) },
  };

  private readonly dilateUniforms = {
    uSrc: { value: null as THREE.Texture | null },
    uMinAlpha: { value: 0.99 },
  };

  private readonly stampMaterial: THREE.ShaderMaterial;
  private readonly bakeMaterial: THREE.ShaderMaterial;
  private readonly dilateMaterial: THREE.ShaderMaterial;
  private readonly hiddenMaterial: THREE.MeshBasicMaterial;
  private readonly depthOverride: THREE.MeshBasicMaterial;

  private readonly fsScene = new THREE.Scene();
  private readonly fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fsMesh: THREE.Mesh;
  private readonly dummyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private scratch: THREE.WebGLRenderTarget | null = null;
  private depthTarget: THREE.WebGLRenderTarget | null = null;
  private depthKey: number[] | null = null;
  private readonly bufferSize = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    this.stampMaterial = new THREE.ShaderMaterial({
      uniforms: this.stampUniforms,
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });

    this.bakeMaterial = new THREE.ShaderMaterial({
      uniforms: this.bakeUniforms,
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.dilateMaterial = new THREE.ShaderMaterial({
      uniforms: this.dilateUniforms,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: DILATE_FRAG,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.depthOverride = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      colorWrite: false,
    });

    this.fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dilateMaterial);
    this.fsMesh.frustumCulled = false;
    this.fsScene.add(this.fsMesh);
  }

  /** Чи є шар фарби для цього матеріалу */
  hasLayer(material: THREE.Material): boolean {
    return this.layers.has(material);
  }

  /** Карту глибини треба оновити (наприклад, змінилась геометрія) */
  invalidateDepth(): void {
    this.depthKey = null;
  }

  /**
   * Готує модель до малювання: створює шар фарби для кожного матеріалу
   * та "запікає" в нього поточний колір і текстуру Albedo.
   */
  prepare(model: THREE.Object3D): void {
    if (this.preparedModel === model) return;
    this.reset();
    this.preparedModel = model;
    model.updateMatrixWorld(true);

    const newLayers: Layer[] = [];

    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry.getAttribute('uv')) return;

      const isArray = Array.isArray(mesh.material);
      const materials = isArray ? (mesh.material as THREE.Material[]) : [mesh.material as THREE.Material];

      materials.forEach((material, slot) => {
        if (!material || !isPaintable(material)) return;

        let layer = this.layers.get(material);
        if (!layer) {
          layer = this.createLayer(material);
          this.layers.set(material, layer);
          newLayers.push(layer);
        }

        const proxyMesh = new THREE.Mesh(mesh.geometry, this.stampMaterial);
        proxyMesh.frustumCulled = false;
        proxyMesh.matrixAutoUpdate = false;
        proxyMesh.matrixWorldAutoUpdate = false;
        proxyMesh.matrixWorld.copy(mesh.matrixWorld);
        layer.scene.add(proxyMesh);

        const entry: ProxyEntry = {
          mesh: proxyMesh,
          source: mesh,
          slot,
          slotCount: isArray ? materials.length : 0,
        };
        layer.proxies.push(entry);
        this.assignMaterial(entry, this.stampMaterial);
      });
    });

    // Запікаємо базовий вигляд матеріалів у шари і підміняємо map на шар фарби
    const originalMaps = new Set<THREE.Texture>();
    for (const layer of newLayers) {
      const material = layer.material;
      const originalMap = material.map;
      this.bake(layer, originalMap, material.color);

      if (originalMap) originalMaps.add(originalMap);
      material.map = layer.target.texture;
      material.color.set(0xffffff); // колір уже запечений у шар
      material.needsUpdate = true;
    }
    // Оригінальні текстури більше не потрібні — звільняємо відеопам'ять
    originalMaps.forEach((texture) => texture.dispose());
  }

  /**
   * Замінює базову текстуру (Albedo) матеріалу, що вже малюється.
   * Намальоване раніше при цьому скидається. Повертає false, якщо шару немає.
   */
  setBaseMap(material: THREE.Material, texture: THREE.Texture): boolean {
    const layer = this.layers.get(material);
    if (!layer) return false;
    this.syncProxies(layer);
    this.bake(layer, texture, new THREE.Color(1, 1, 1));
    return true;
  }

  /** Малює відбитки кисті на всіх видимих поверхнях моделі */
  paint(req: PaintRequest): void {
    if (this.layers.size === 0 || req.points.length === 0) return;

    const { scene, camera } = req;
    const renderer = this.renderer;
    camera.updateMatrixWorld();

    renderer.getDrawingBufferSize(this.bufferSize);
    const width = this.bufferSize.x;
    const height = this.bufferSize.y;

    this.withRenderState(() => {
      // 1. Карта глибини з поточної камери (оновлюємо, лише якщо камера змінилась)
      const depthTarget = this.ensureDepthTarget(width, height);
      const key = this.cameraKey(camera, width, height);
      if (!this.depthKey || !this.sameKey(this.depthKey, key)) {
        this.renderDepth(scene, camera, depthTarget);
        this.depthKey = key;
      }

      // 2. Загальні uniform-и мазка
      const u = this.stampUniforms;
      u.uDepth.value = depthTarget.depthTexture;
      u.uResolution.value.set(width, height);
      u.uViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      camera.getWorldPosition(u.uCameraPos.value);
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uRadius.value = req.radiusPx;
      u.uHardness.value = req.hardness;
      u.uModelSize.value = req.modelSize;
      u.uColor.value.copy(req.color);

      for (const layer of this.layers.values()) this.syncProxies(layer);

      // 3. Відбитки пачками по MAX_STAMPS — один рендер на пачку для кожного шару
      renderer.autoClear = false;
      for (let i = 0; i < req.points.length; i += MAX_STAMPS) {
        const chunk = req.points.slice(i, i + MAX_STAMPS);
        chunk.forEach((p, k) => this.centers[k].set(p.x, p.y));
        u.uCount.value = chunk.length;

        for (const layer of this.layers.values()) {
          renderer.setRenderTarget(layer.target);
          renderer.render(layer.scene, this.dummyCamera);
          layer.dirty = true;
        }
      }
    });
  }

  /** Розширює UV-острівці (padding) у шарах, які змінились. Викликати раз на кадр. */
  flush(): void {
    for (const layer of this.layers.values()) {
      if (layer.dirty) this.dilate(layer);
    }
  }

  /** Прибирає всі шари (наприклад, при завантаженні нової моделі) */
  reset(): void {
    for (const layer of this.layers.values()) {
      layer.proxies.forEach((p) => layer.scene.remove(p.mesh));
      layer.target.dispose();
    }
    this.layers.clear();
    this.preparedModel = null;
    this.depthKey = null;
  }

  dispose(): void {
    this.reset();
    this.scratch?.dispose();
    this.depthTarget?.depthTexture?.dispose();
    this.depthTarget?.dispose();
    this.scratch = null;
    this.depthTarget = null;
    this.stampMaterial.dispose();
    this.bakeMaterial.dispose();
    this.dilateMaterial.dispose();
    this.hiddenMaterial.dispose();
    this.depthOverride.dispose();
    this.fsMesh.geometry.dispose();
  }

  // ---------------------------------------------------------------------------

  private createLayer(material: PaintableMaterial): Layer {
    const target = this.createTarget(true);
    return { material, target, scene: new THREE.Scene(), proxies: [], dirty: false };
  }

  private createTarget(withMipmaps: boolean): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: withMipmaps,
      minFilter: withMipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter,
      magFilter: withMipmaps ? THREE.LinearFilter : THREE.NearestFilter,
    });
    // sRGB: фарба блендиться в лінійному просторі, а зберігається в sRGB
    target.texture.colorSpace = THREE.SRGBColorSpace;
    if (withMipmaps) {
      target.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }
    return target;
  }

  private ensureScratch(): THREE.WebGLRenderTarget {
    if (!this.scratch) this.scratch = this.createTarget(false);
    return this.scratch;
  }

  private ensureDepthTarget(width: number, height: number): THREE.WebGLRenderTarget {
    const current = this.depthTarget;
    if (current && current.width === width && current.height === height) return current;

    current?.depthTexture?.dispose();
    current?.dispose();

    const target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    target.depthTexture = depthTexture;

    this.depthTarget = target;
    this.depthKey = null;
    return target;
  }

  private renderDepth(
    scene: THREE.Scene,
    camera: THREE.Camera,
    target: THREE.WebGLRenderTarget
  ): void {
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    scene.overrideMaterial = this.depthOverride;
    scene.background = null;
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.autoClear = true;
      this.renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
    }
  }

  private cameraKey(camera: THREE.Camera, width: number, height: number): number[] {
    return [
      ...camera.matrixWorld.elements,
      ...(camera as THREE.PerspectiveCamera).projectionMatrix.elements,
      width,
      height,
    ];
  }

  private sameKey(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Підтягує геометрію та матрицю оригінального меша (вони могли змінитись) */
  private syncProxies(layer: Layer): void {
    for (const p of layer.proxies) {
      p.mesh.geometry = p.source.geometry;
      p.mesh.matrixWorld.copy(p.source.matrixWorld);
    }
  }

  /** Призначає матеріал проксі; у мешів з кількома матеріалами решта слотів приховується */
  private assignMaterial(entry: ProxyEntry, material: THREE.Material): void {
    if (entry.slotCount === 0) {
      entry.mesh.material = material;
    } else {
      entry.mesh.material = Array.from({ length: entry.slotCount }, (_, i) =>
        i === entry.slot ? material : this.hiddenMaterial
      );
    }
  }

  /** Перемальовує шар: базовий колір * текстура всередині UV-острівців, поза ними — порожньо */
  private bake(layer: Layer, map: THREE.Texture | null, color: THREE.Color): void {
    this.withRenderState(() => {
      const renderer = this.renderer;
      this.bakeUniforms.uMap.value = map;
      this.bakeUniforms.uHasMap.value = map !== null;
      this.bakeUniforms.uColor.value.copy(color);

      layer.proxies.forEach((p) => this.assignMaterial(p, this.bakeMaterial));

      renderer.setRenderTarget(layer.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear(true, false, false);
      renderer.render(layer.scene, this.dummyCamera);

      layer.proxies.forEach((p) => this.assignMaterial(p, this.stampMaterial));
    });
    this.dilate(layer);
  }

  /** Padding: заповнює порожні текселі навколо острівців кольором найближчих сусідів */
  private dilate(layer: Layer): void {
    const scratch = this.ensureScratch();
    this.withRenderState(() => {
      const renderer = this.renderer;
      renderer.autoClear = false;

      for (let i = 0; i < PADDING_PASSES; i++) {
        const src = i % 2 === 0 ? layer.target : scratch;
        const dst = i % 2 === 0 ? scratch : layer.target;
        // Перший прохід вважає джерелом лише справжні пікселі (стара "рамка" перераховується),
        // наступні — і справжні, і вже заповнені
        this.dilateUniforms.uSrc.value = src.texture;
        this.dilateUniforms.uMinAlpha.value = i === 0 ? 0.99 : 0.25;
        renderer.setRenderTarget(dst);
        renderer.render(this.fsScene, this.fsCamera);
      }
    });
    layer.dirty = false;
  }

  private withRenderState(fn: () => void): void {
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    try {
      fn();
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(prevClearColor, prevClearAlpha);
    }
  }
}
