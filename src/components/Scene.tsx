import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshPainter } from '../paint/MeshPainter';

/**
 * TurboPainter MVP - 3D сцена з кубом
 *
 * Функціонал:
 * - Ліва кнопка миші — обертання камери навколо об'єкта (у режимі малювання — малювання)
 * - Права кнопка миші — вільний огляд навколо об'єкта (трекбол-режим)
 * - Колесо миші — зум
 * - Налаштування розміру та кольору кубу через props
 * - Проєкційна кисть (як у Substance Painter): коло постійного розміру на екрані,
 *   фарба лягає на всі видимі поверхні моделі
 */

interface SceneProps {
  /** Заголовок сцени */
  title?: string;
  /** Інструкція для користувача */
  instruction?: string;
  /** Колір кубу (hex) */
  cubeColor?: number;
  /** Розмір кубу */
  cubeSize?: number;
  /** Текст інструкції з модифікаторами (опціонально) */
  modifierInstruction?: string;
  /** Callback для завантаження моделі */
  onModelLoad?: (file: File) => void;
  /** Колір кисті (CSS hex, наприклад '#ff0000') */
  brushColor?: string;
  /** Радіус кисті в пікселях екрана */
  brushSize?: number;
  /** Шари (знизу вгору) */
  layers?: Array<{ id: string; visible: boolean }>;
  /** Простір розміру кисті: 'screen' — пікселі екрана, 'model' — частка розміру моделі */
  brushSpace?: 'screen' | 'model';
  /** Активний інструмент малювання */
  tool?: 'brush' | 'eraser';
  /** Активний шар — у нього йде малювання */
  activeLayerId?: string | null;
}

/** Відступ усередині комірки UV-атласу куба (частка комірки) — місце під padding між гранями */
const CUBE_ATLAS_PADDING = 0.015;

/** Жорсткість кисті: частка радіуса з повною непрозорістю, далі м'який край */
const BRUSH_HARDNESS = 0.8;

/** Відстань між відбитками кисті як частка радіуса */
const BRUSH_SPACING = 0.2;

/**
 * Створює куб з UV-атласом 3x2: кожна грань займає власну комірку текстури.
 * У стандартному BoxGeometry всі 6 граней мають однакові UV (0..1), тому малюнок
 * дублювався б на всіх гранях одразу.
 */
function createCubeGeometry(size: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const inner = 1 - 2 * CUBE_ATLAS_PADDING;

  // BoxGeometry будує грані по черзі (+x, -x, +y, -y, +z, -z), по 4 вершини на грань
  for (let face = 0; face < 6; face++) {
    const col = face % 3;
    const row = Math.floor(face / 3);
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      const u = uv.getX(idx);
      const v = uv.getY(idx);
      uv.setXY(
        idx,
        (col + CUBE_ATLAS_PADDING + u * inner) / 3,
        (row + CUBE_ATLAS_PADDING + v * inner) / 2
      );
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Знаходить перший меш у дереві об'єктів Three.js
 */
function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let result: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!result && (child as THREE.Mesh).isMesh) {
      result = child as THREE.Mesh;
    }
  });
  return result;
}

type MaterialChannel = 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'emissiveMap';

interface SceneRef {
  loadModelFromFile: (file: File) => void;
  applyTextureToChannel: (channel: MaterialChannel, file: File) => void;
  setPaintMode: (enabled: boolean) => void;
}

export const Scene = forwardRef<SceneRef, SceneProps>(
  function Scene({
    title = '3D Сцена',
    instruction = "Left mouse button — rotate camera, right mouse button — pan view, scroll wheel — zoom",
    cubeColor = 0x888888,
    cubeSize = 1,
    modifierInstruction = "Middle mouse or Alt+LMB — pan, Left mouse — rotate",
    onModelLoad = undefined,
    brushColor = '#ff0000',
    brushSize = 24,
    layers = [],
    brushSpace = 'screen',
    tool = 'brush',
    activeLayerId = null,
  }: SceneProps, ref) {
    // Рефи на DOM елементи та Three.js об'єкти
    const containerRef = useRef<HTMLDivElement>(null);
    const brushCursorRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const currentModelRef = useRef<THREE.Object3D | null>(null);
    const isCustomModelRef = useRef<boolean>(false);

    // Режим малювання
    const isPaintModeRef = useRef<boolean>(false);

    // GPU-малярка (шари фарби у UV-просторі для кожного матеріалу)
    const painterRef = useRef<MeshPainter | null>(null);

    // Поточні налаштування кисті (ref, бо обробники подій реєструються один раз)
    const brushRef = useRef({ color: brushColor, size: brushSize, space: brushSpace, tool });
    brushRef.current = { color: brushColor, size: brushSize, space: brushSpace, tool };
    const depthCacheRef = useRef<{ key: string; point: THREE.Vector3 } | null>(null);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

    // Стан мазка: позиції в CSS-пікселях відносно canvas
    const strokeRef = useRef({ active: false, lastX: 0, lastY: 0, modelSize: 1 });

    // --- Стан контролера камери (зберігається в useRef для збереження між рендерами) ---
    const controllerState = useRef({
      // Сферичні координати
      radius: 6,
      minRadius: 2,
      maxRadius: 20,
      theta: Math.PI / 4,    // Кут обертання навколо осі Y (горизонтальне)
      phi: Math.PI / 3,      // Кут обертання навколо осі X (вертикальне)

      // Точка фокусу (target) — камера завжди дивиться сюди.
      target: new THREE.Vector3(0, 0, 0),

      // Останні координати курсора для розрахунку дельти
      lastX: 0,
      lastY: 0,

      // Стан взаємодії
      isRotating: false,   // Ліва кнопка — обертання навколо об'єкта
      isPanning: false,    // Права кнопка — вільний огляд (трекбол-режим)
    });

    // Обмеження
    const MIN_PHI = 0.1;
    const MAX_PHI = Math.PI - 0.1;

    // --- Малювання ---

    /** Найбільший розмір поточної моделі (для допусків перевірки видимості) */
    function getModelSize(): number {
      const model = currentModelRef.current;
      if (!model) return 1;
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(model).getSize(size);
      return Math.max(size.x, size.y, size.z, 1e-6);
    }

    /**
     * Радіус кисті в CSS-пікселях екрана.
     * 'screen': завжди дорівнює size. 'model': радіус прив'язаний до розміру моделі
     * (при size=24 це ~16% розміру моделі), тому на екрані росте при наближенні камери.
     */
    function getBrushRadiusCss(at?: { x: number; y: number }): number {
      const { size, space } = brushRef.current;
      if (space === 'screen') return size;

      const camera = cameraRef.current;
      const dom = rendererRef.current?.domElement;
      const model = currentModelRef.current;
      if (!camera || !dom || !model) return size;

      const box = new THREE.Box3().setFromObject(model);
      const dim = box.getSize(new THREE.Vector3());
      const modelSize = Math.max(dim.x, dim.y, dim.z, 1e-6);
      camera.updateMatrixWorld();
      // Глибина поверхні під курсором (перспектива: ближче до камери — більше пікселів на одиницю).
      // Якщо під курсором нічого немає, беремо глибину центру моделі.
      let point = box.getCenter(new THREE.Vector3());
      if (at) {
        const key = `${at.x.toFixed(1)},${at.y.toFixed(1)},${camera.matrixWorld.elements.join(',')}`;
        const cache = depthCacheRef.current;
        if (cache && cache.key === key) {
          point = cache.point;
        } else {
          const rect = dom.getBoundingClientRect();
          const ndc = new THREE.Vector2((at.x / rect.width) * 2 - 1, -(at.y / rect.height) * 2 + 1);
          const raycaster = new THREE.Raycaster();
          raycaster.setFromCamera(ndc, camera);
          const hit = raycaster.intersectObject(model, true)[0];
          if (hit) point = hit.point;
          depthCacheRef.current = { key, point: point.clone() };
        }
      }
      const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
      if (depth <= camera.near) return size;

      const viewHeight = dom.getBoundingClientRect().height;
      const pxPerUnit = viewHeight / (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const worldRadius = (size / 150) * modelSize;
      return Math.max(1, worldRadius * pxPerUnit);
    }

    /**
     * Відмальовує відбитки кисті в заданих точках (CSS-пікселі відносно canvas).
     * Мазок проєктується з екрана на всі видимі поверхні моделі.
     */
    function stampAt(points: Array<{ x: number; y: number }>) {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      const painter = painterRef.current;
      if (!renderer || !camera || !scene || !painter || points.length === 0) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const scaleX = renderer.domElement.width / rect.width;
      const scaleY = renderer.domElement.height / rect.height;

      painter.paint({
        scene,
        camera,
        // У WebGL початок координат — лівий нижній кут
        points: points.map((p) => ({ x: p.x * scaleX, y: (rect.height - p.y) * scaleY })),
        radiusPx: getBrushRadiusCss(points[points.length - 1]) * scaleX,
        hardness: BRUSH_HARDNESS,
        color: new THREE.Color(brushRef.current.color),
        erase: brushRef.current.tool === 'eraser',
        modelSize: strokeRef.current.modelSize,
      });
    }

    /** Кільце-курсор показує реальний екранний розмір кисті */
    function updateBrushCursor(clientX: number, clientY: number) {
      const el = brushCursorRef.current;
      const dom = rendererRef.current?.domElement;
      if (!el || !dom) return;

      if (!isPaintModeRef.current) {
        el.style.display = 'none';
        return;
      }

      const rect = dom.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      if (!inside && !strokeRef.current.active) {
        el.style.display = 'none';
        return;
      }

      const diameter = getBrushRadiusCss({ x, y }) * 2;
      el.style.display = 'block';
      el.style.width = `${diameter}px`;
      el.style.height = `${diameter}px`;
      el.style.left = `${x - diameter / 2}px`;
      el.style.top = `${y - diameter / 2}px`;
    }

    // --- Обробники подій миші ---

    function onPointerDown(e: PointerEvent) {
      const state = controllerState.current;

      if (e.button === 0) {     // Ліва кнопка — обертання навколо об'єкта
        if (isPaintModeRef.current) {
          // У режимі малювання LMB малює (камеру не обертає)
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          strokeRef.current = { active: true, lastX: x, lastY: y, modelSize: getModelSize() };
          stampAt([{ x, y }]);
        } else {
          state.isRotating = true;
        }
      } else if (e.button === 1) {   // Середня кнопка — обертання (коли увімкнено режим малювання)
        if (isPaintModeRef.current) {
          state.isRotating = true;
        }
      } else if (e.button === 2) { // Права кнопка — вільний огляд
        state.isPanning = true;
      }

      // Зберігаємо стартову позицію курсора
      state.lastX = e.clientX;
      state.lastY = e.clientY;
    }

    function onPointerUp() {
      controllerState.current.isRotating = false;
      controllerState.current.isPanning = false;
      // Завершуємо мазок
      strokeRef.current.active = false;
    }

    function onPointerMove(e: PointerEvent) {
      const state = controllerState.current;

      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;

      const stroke = strokeRef.current;
      if (stroke.active) {
        const dom = rendererRef.current?.domElement;
        if (dom) {
          const rect = dom.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Відбитки лягають з постійним кроком уздовж траєкторії курсора
          const spacing = Math.max(1, getBrushRadiusCss({ x: stroke.lastX, y: stroke.lastY }) * BRUSH_SPACING);
          const points: Array<{ x: number; y: number }> = [];
          let dist = Math.hypot(x - stroke.lastX, y - stroke.lastY);
          while (dist >= spacing && points.length < 400) {
            const t = spacing / dist;
            stroke.lastX += (x - stroke.lastX) * t;
            stroke.lastY += (y - stroke.lastY) * t;
            points.push({ x: stroke.lastX, y: stroke.lastY });
            dist = Math.hypot(x - stroke.lastX, y - stroke.lastY);
          }
          stampAt(points);
        }
      }

      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      updateBrushCursor(e.clientX, e.clientY);

      if (state.isRotating) {
        // Ліва кнопка: обертання навколо об'єкта — оновлюємо кути
        state.theta -= dx * 0.01;
        state.phi -= dy * 0.01;
        state.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, state.phi));
      }

      if (state.isPanning) {
        // Права кнопка: панорамування — рухаємо камеру і target разом по локальних осях камери
        const cam = cameraRef.current;
        if (cam) {
          const right = new THREE.Vector3();
          const up = new THREE.Vector3();
          cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());

          const panSpeed = 0.003 * state.radius; // масштаб з відстанню, як у ArmorPaint

          const panDelta = new THREE.Vector3()
            .addScaledVector(right, -dx * panSpeed)
            .addScaledVector(up, dy * panSpeed);

          cam.position.add(panDelta);
          state.target.add(panDelta); // критично: зсуваємо і target, інакше snap-back
          cam.lookAt(state.target);
        }
      }

      // Оновлюємо останні координати курсора після розрахунку дельти
      state.lastX = e.clientX;
      state.lastY = e.clientY;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const state = controllerState.current;

      // Колесо миші: зум (зміна радіусу)
      const zoomSensitivity = 0.002;
      state.radius += e.deltaY * zoomSensitivity;
      state.radius = Math.max(state.minRadius, Math.min(state.maxRadius, state.radius));
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    // --- Функція оновлення позиції камери ---
    function updateCameraFromOrbit() {
      const cam = cameraRef.current;
      const state = controllerState.current;
      if (!cam) return;

      // Only apply orbit math when NOT panning
      if (state.isPanning) {
        return; // Skip orbit calculation, use position from onPointerMove()
      }

      // Обчислюємо позицію камери за сферичними координатами відносно точки фокусу
      const x = state.radius * Math.sin(state.phi) * Math.sin(state.theta);
      const y = state.radius * Math.cos(state.phi);
      const z = state.radius * Math.sin(state.phi) * Math.cos(state.theta);

      // Позиція камери = точка фокусу + зміщення за сферичними координатами
      cam.position.set(
        state.target.x + x,
        state.target.y + y,
        state.target.z + z
      );

      // Камера завжди дивиться на точку фокусу (позицію куба) без смещения
      cam.lookAt(state.target);
    }

    // Функція застосування текстури до каналу матеріалу
    function applyTextureToChannel(channel: MaterialChannel, file: File) {
      if (!currentModelRef.current) return;

      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();

      loader.load(url, (texture) => {
        texture.flipY = false; // узгодити з конвенцією glTF
        texture.colorSpace = (channel === 'map' || channel === 'emissiveMap')
          ? THREE.SRGBColorSpace
          : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;

        let textureUsed = false;

        currentModelRef.current!.traverse((child: any) => {
          if (!child.isMesh) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];

          materials.forEach((mat: THREE.MeshStandardMaterial) => {
            // Albedo для матеріалу, який уже малюється: переписуємо базу шару фарби.
            // Малярка лише "запікає" текстуру в шар, тож сама текстура далі не потрібна.
            if (channel === 'map' && painterRef.current?.setBaseMap(mat, texture)) {
              return;
            }

            textureUsed = true;
            const oldTexture = mat[channel];
            if (oldTexture) oldTexture.dispose(); // звільняємо стару текстуру

            mat[channel] = texture;

            if (channel === 'emissiveMap') {
              mat.emissive.set(0xffffff); // інакше emissiveMap не буде видно
            }

            mat.needsUpdate = true;
          });
        });

        if (!textureUsed) texture.dispose();
        URL.revokeObjectURL(url);
      });
    }

    // Функція завантаження моделі з файлу
    function loadModelFromFile(file: File) {
      const reader = new FileReader();

      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;

        new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
          const gltfScene = gltf.scene;

          // Шари фарби належать попередній моделі — вивільняємо
          painterRef.current?.reset();
          strokeRef.current.active = false;

          // а) Якщо існує поточна модель — прибрати зі сцени та вивільнити пам'ять
          if (currentModelRef.current) {
            const oldModel = currentModelRef.current;
            sceneRef.current?.remove(oldModel);

            // Вивільняємо геометрію та матеріали старої моделі
            oldModel.traverse((child: any) => {
              if (child.isMesh) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                  child.material.forEach((m: THREE.Material) => m.dispose());
                } else {
                  child.material?.dispose();
                }
              }
            });
          }

          // б) Додаємо нову модель у сцену
          sceneRef.current?.add(gltfScene);
          currentModelRef.current = gltfScene;

          // Якщо ми в режимі малювання — одразу готуємо шари фарби для нової моделі
          if (isPaintModeRef.current) {
            painterRef.current?.prepare(gltfScene);
          }

          // в) Обчислюємо центр та розмір моделі
          const box = new THREE.Box3().setFromObject(gltfScene);
          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          box.getCenter(center);
          box.getSize(size);

          // г) Виставляємо target на центр моделі
          controllerState.current.target.copy(center);

          // д) Виставляємо радіус камери (макс розмір * 2)
          controllerState.current.radius = Math.max(size.x, size.y, size.z) * 2;

          // Перерахунок меж під розмір саме цієї моделі
          const maxDim = Math.max(size.x, size.y, size.z);
          controllerState.current.minRadius = maxDim * 0.5;
          controllerState.current.maxRadius = maxDim * 5;
          controllerState.current.radius = maxDim * 2; // вже в межах нових minRadius/maxRadius

          // е) Оновлюємо камеру одразу після зміни
          updateCameraFromOrbit();

          // Повідомляємо батька про завантаження моделі
          onModelLoad?.(file);

          // Позначаємо, що це кастомна модель
          isCustomModelRef.current = true;
        }, (err) => {
          console.error('Error loading GLTF model:', err);
        });
      };

      reader.readAsArrayBuffer(file);
    }

    // --- Ініціалізація сцени ---
    useEffect(() => {
      if (!containerRef.current) return;

      // 1. Створення сцени
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);
      sceneRef.current = scene;

      // 2. Камера
      const camera = new THREE.PerspectiveCamera(
        75,
        containerRef.current.clientWidth / containerRef.current.clientHeight,
        0.1,
        1000
      );
      cameraRef.current = camera;

      // 3. Рендерер
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      containerRef.current.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // GPU-малярка
      painterRef.current = new MeshPainter(renderer);
      // Підписка на події контролера камери
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
      renderer.domElement.addEventListener('contextmenu', onContextMenu);

      // 4. Створення початкового куба (перша модель)
      const geometry = createCubeGeometry(1);
      const material = new THREE.MeshStandardMaterial({
        color: cubeColor,
        roughness: 0.5,
        metalness: 0.1
      });
      const cubeMesh = new THREE.Mesh(geometry, material);
      scene.add(cubeMesh);
      currentModelRef.current = cubeMesh;

      // Жорстке обмеження: target завжди дорівнює позиції першої моделі
      if (currentModelRef.current) {
        controllerState.current.target.copy(currentModelRef.current.position);
      }

      // Виставити коректну позицію камери одразу, до першої взаємодії
      updateCameraFromOrbit();

      // 5. Освітлення
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 10, 7);
      scene.add(directionalLight);

      // 6. Анімаційний цикл
      function animate() {
        requestAnimationFrame(animate);

        updateCameraFromOrbit(); // викликати щокадру безумовно

        // Дозаповнюємо краї UV-острівців у шарах, що змінились (padding проти швів)
        painterRef.current?.flush();
        // У режимі "розмір на моделі" кільце змінюється при зумі, навіть коли миша нерухома
        if (brushRef.current.space === 'model' && lastPointerRef.current) {
          updateBrushCursor(lastPointerRef.current.x, lastPointerRef.current.y);
        }

        if (sceneRef.current && cameraRef.current) {
          renderer.render(sceneRef.current, cameraRef.current);
        }
      }

      animate();

      // 7. Обробка змін розміру вікна
      function onWindowResize() {
        if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;

        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;

        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
      }

      window.addEventListener('resize', onWindowResize);

      // 8. ResizeObserver для контейнера
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            onWindowResize();
          }
        }
      });

      if (containerRef.current) {
        observer.observe(containerRef.current);
      }

      // Cleanup
      return () => {
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointermove', onPointerMove);
        renderer.domElement.removeEventListener('wheel', onWheel);
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('resize', onWindowResize);
        observer.disconnect();

        painterRef.current?.dispose();
        painterRef.current = null;

        if (rendererRef.current && rendererRef.current.domElement?.parentElement) {
          rendererRef.current.domElement.parentElement.removeChild(rendererRef.current.domElement);
        }
      };
    }, []);

    // Синхронізація кольору
    useEffect(() => {
      if (!currentModelRef.current || isCustomModelRef.current) return;
      const firstMesh = findFirstMesh(currentModelRef.current);
      if (firstMesh) {
        const meshMaterial = firstMesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        const materials = Array.isArray(meshMaterial) ? meshMaterial : [meshMaterial];
        materials.forEach(m => {
          // Після початку малювання базовий колір вже "запечений" у шар фарби
          // (material.color = білий), тому тінт не застосовуємо, щоб не спотворити фарбу
          if (painterRef.current?.ownsMaterial(m)) return;
          m.color.set(cubeColor);
        });
      }
    }, [cubeColor]);

    // Синхронізація шарів зі станом UI
    useEffect(() => {
      painterRef.current?.syncLayers(layers, activeLayerId);
    }, [layers, activeLayerId]);

    // Синхронізація розміру
    useEffect(() => {
      if (!currentModelRef.current || isCustomModelRef.current) return;
      const firstMesh = findFirstMesh(currentModelRef.current);
      if (firstMesh) {
        firstMesh.geometry.dispose();
        firstMesh.geometry = createCubeGeometry(cubeSize);
        painterRef.current?.invalidateDepth();
      }
    }, [cubeSize]);

    // Функція для перемикання режиму малювання
    function setPaintMode(enabled: boolean) {
      isPaintModeRef.current = enabled;

      // Перериваємо поточний мазок і ховаємо кільце-курсор
      strokeRef.current.active = false;
      if (brushCursorRef.current) brushCursorRef.current.style.display = 'none';
      if (rendererRef.current) {
        rendererRef.current.domElement.style.cursor = enabled ? 'none' : 'default';
      }

      if (enabled && currentModelRef.current) {
        // При першому вході в режим малювання — створюємо шари фарби для кожного матеріалу.
        // Повторні виклики нічого не скидають: намальоване зберігається.
        painterRef.current?.prepare(currentModelRef.current);
      }
    }

    useImperativeHandle(ref, () => ({
      loadModelFromFile,
      applyTextureToChannel,
      setPaintMode
    }));

    // --- Return JSX ---
    return (
      <div ref={containerRef} className="absolute inset-0 w-full h-full">
       <div className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-gray-700">
           <h1 className="text-white font-bold text-lg mb-2">{title}</h1>

           {/* Інструкція */}
           <div className="bg-gray-700/80 rounded p-3 mb-4">
             <p className="text-gray-300 text-xs">{instruction}</p>
             {modifierInstruction && (
               <p className="text-blue-300 text-xs mt-2">{modifierInstruction}</p>
             )}
           </div>

           {/* Інфо-панель */}
          <div className="absolute bottom-4 left-4 bg-gray-800/90 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-gray-700">
            <div className="text-gray-400 text-xs space-y-1">
              <p>• Three.js 0.170</p>
              <p>• React + Vite</p>
              <p>• TailwindCSS</p>
            </div>
          </div>
        </div>

        {/* Кільце-курсор кисті (позиціюється напряму через ref, без перерендеру React) */}
        <div
          ref={brushCursorRef}
          className="pointer-events-none absolute z-10 rounded-full"
          style={{
            display: 'none',
            border: tool === 'eraser' ? '1px dashed rgba(255,255,255,0.95)' : '1px solid rgba(255,255,255,0.9)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
          }}
        />
      </div>
    );
  }
);
