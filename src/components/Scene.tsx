import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * TurboPainter MVP - 3D сцена з кубом
 * 
 * Функціонал:
 * - Ліва кнопка миші — обертання камери навколо об'єкта
 * - Права кнопка миші — вільний огляд навколо об'єкта (трекбол-режим)
 * - Колесо миші — зум
 * - Налаштування розміру та кольору кубу через props
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
  /** Радіус кисті в пікселях текстури 1024x1024 */
  brushSize?: number;
}

/** Розмір canvas-текстури для малювання */
const PAINT_TEXTURE_SIZE = 1024;

/** Відступ усередині комірки UV-атласу куба (частка комірки), щоб мазок не затікав на сусідню грань */
const CUBE_ATLAS_PADDING = 0.08;

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
        // Текстури в нас з flipY = false (як у glTF): v = 0 — верхній рядок canvas
        (row + CUBE_ATLAS_PADDING + (1 - v) * inner) / 2
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

interface PaintCanvasInfo {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

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
  }: SceneProps, ref) {
    // Рефи на DOM елементи та Three.js об'єкти
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const currentModelRef = useRef<THREE.Object3D | null>(null);
    const isCustomModelRef = useRef<boolean>(false);

    // Режим малювання
    const isPaintModeRef = useRef<boolean>(false);

    // Map для зберігання canvas/texture пар для кожного матеріалу
    const paintCanvasesRef = useRef<Map<THREE.Material, PaintCanvasInfo>>(new Map());

    // Поточні налаштування кисті (ref, бо обробники подій реєструються один раз)
    const brushRef = useRef({ color: brushColor, size: brushSize });
    brushRef.current = { color: brushColor, size: brushSize };

    // Стан мазка: чи тиснемо ЛКМ та остання точка на canvas (для з'єднання точок лінією)
    const paintStateRef = useRef<{
      isPainting: boolean;
      last: { info: PaintCanvasInfo; x: number; y: number } | null;
    }>({ isPainting: false, last: null });

    const raycasterRef = useRef(new THREE.Raycaster());

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

    /**
     * Ставить один відбиток кисті в точці екрана: промінь з камери -> перетин з моделлю ->
     * UV точки перетину -> піксель на canvas-текстурі відповідного матеріалу.
     */
    function paintAtClient(clientX: number, clientY: number) {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const model = currentModelRef.current;
      const paint = paintStateRef.current;
      if (!renderer || !camera || !model) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );

      camera.updateMatrixWorld();
      raycasterRef.current.setFromCamera(ndc, camera);
      const hit = raycasterRef.current.intersectObject(model, true)[0];

      // Промінь не потрапив у модель (або в меш без UV) — розриваємо мазок
      if (!hit || !hit.uv) {
        paint.last = null;
        return;
      }

      const mesh = hit.object as THREE.Mesh;
      const material = Array.isArray(mesh.material)
        ? mesh.material[hit.face?.materialIndex ?? 0]
        : mesh.material;
      const info = paintCanvasesRef.current.get(material);
      if (!info) {
        paint.last = null;
        return;
      }

      // UV можуть виходити за 0..1 (RepeatWrapping) — зводимо до одиничного квадрата
      const u = hit.uv.x - Math.floor(hit.uv.x);
      const v = hit.uv.y - Math.floor(hit.uv.y);
      const x = u * info.canvas.width;
      const y = v * info.canvas.height; // flipY = false: v = 0 — верхній рядок canvas

      const { ctx } = info;
      const { color, size } = brushRef.current;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 2;
      ctx.lineCap = 'round';

      const last = paint.last;
      const maxJump = info.canvas.width * 0.15; // більший стрибок = перетнули UV-шов, не з'єднуємо
      if (last && last.info === info && Math.hypot(x - last.x, y - last.y) < maxJump) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      info.texture.needsUpdate = true;
      paint.last = { info, x, y };
    }

    /**
     * Мазок між двома позиціями курсора: проміжні точки беремо кожні ~3 px екрана,
     * щоб при швидкому русі лінія не мала розривів.
     */
    function paintStroke(fromX: number, fromY: number, toX: number, toY: number) {
      const dist = Math.hypot(toX - fromX, toY - fromY);
      const steps = Math.min(300, Math.max(1, Math.ceil(dist / 3)));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paintAtClient(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
      }
    }

    // --- Обробники подій миші ---

    function onPointerDown(e: PointerEvent) {
      const state = controllerState.current;

      if (e.button === 0) {     // Ліва кнопка — обертання навколо об'єкта
        if (isPaintModeRef.current) {
          // У режимі малювання LMB малює (камеру не обертає)
          paintStateRef.current.isPainting = true;
          paintStateRef.current.last = null;
          paintAtClient(e.clientX, e.clientY);
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
      paintStateRef.current.isPainting = false;
      paintStateRef.current.last = null;
    }

    function onPointerMove(e: PointerEvent) {
      const state = controllerState.current;

      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;

      if (paintStateRef.current.isPainting) {
        // lastX/lastY — позиція курсора на попередньому кадрі
        paintStroke(state.lastX, state.lastY, e.clientX, e.clientY);
      }

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
            // Albedo для матеріалу, який уже малюється: вмальовуємо картинку в canvas,
            // щоб не втратити можливість малювати (map лишається CanvasTexture)
            const paintInfo = channel === 'map' ? paintCanvasesRef.current.get(mat) : undefined;
            if (paintInfo) {
              paintInfo.ctx.fillStyle = '#ffffff';
              paintInfo.ctx.fillRect(0, 0, paintInfo.canvas.width, paintInfo.canvas.height);
              try {
                paintInfo.ctx.drawImage(
                  texture.image as CanvasImageSource,
                  0, 0, paintInfo.canvas.width, paintInfo.canvas.height
                );
              } catch (err) {
                console.warn('Could not draw texture to canvas:', err);
              }
              paintInfo.texture.needsUpdate = true;
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
          
          // Старі canvas для малювання належать попередній моделі — вивільняємо
          paintCanvasesRef.current.forEach((info) => info.texture.dispose());
          paintCanvasesRef.current.clear();
          paintStateRef.current.last = null;

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

          // Якщо ми в режимі малювання — одразу готуємо canvas для нової моделі
          if (isPaintModeRef.current) {
            initializePaintCanvasesForModel();
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
          // Після початку малювання базовий колір вже "запечений" у canvas
          // (material.color = білий), тому тінт не застосовуємо, щоб не спотворити фарбу
          if (paintCanvasesRef.current.has(m)) return;
          m.color.set(cubeColor);
        });
      }
    }, [cubeColor]);

    // Синхронізація розміру
    useEffect(() => {
      if (!currentModelRef.current || isCustomModelRef.current) return;
      const firstMesh = findFirstMesh(currentModelRef.current);
      if (firstMesh) {
        firstMesh.geometry.dispose();
        firstMesh.geometry = createCubeGeometry(cubeSize);
      }
    }, [cubeSize]);

    // Функція ініціалізації CanvasTexture для кожного матеріалу поточної моделі
    function initializePaintCanvasesForModel() {
      if (!currentModelRef.current) return;

      // Проходимо по всіх мешах у моделі
      currentModelRef.current.traverse((child: any) => {
        if (!child.isMesh) return;

        const materials = Array.isArray(child.material) ? child.material : [child.material];

        materials.forEach((material: THREE.MeshStandardMaterial) => {
          // Canvas для цього матеріалу вже є — зберігаємо те, що намальовано раніше
          if (paintCanvasesRef.current.has(material)) return;

          // Створюємо новий canvas
          const canvas = document.createElement('canvas');
          canvas.width = PAINT_TEXTURE_SIZE;
          canvas.height = PAINT_TEXTURE_SIZE;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          // Отримуємо поточну текстуру матеріалу (map канал)
          const currentMap = material.map;

          if (currentMap && currentMap.image) {
            // Є текстура — беремо її за основу (material.color не чіпаємо)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, PAINT_TEXTURE_SIZE, PAINT_TEXTURE_SIZE);
            try {
              ctx.drawImage(currentMap.image as CanvasImageSource, 0, 0, PAINT_TEXTURE_SIZE, PAINT_TEXTURE_SIZE);
            } catch (err) {
              console.warn('Could not draw texture to canvas:', err);
            }
          } else {
            // Текстури немає — "запікаємо" колір матеріалу в canvas і скидаємо
            // material.color на білий, інакше колір помножився б на фарбу вдруге
            ctx.fillStyle = material.color ? `#${material.color.getHexString()}` : '#ffffff';
            ctx.fillRect(0, 0, PAINT_TEXTURE_SIZE, PAINT_TEXTURE_SIZE);
            material.color?.set(0xffffff);
          }

          // Створюємо CanvasTexture з canvas
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.flipY = false;

          // Зберігаємо пару {canvas, ctx, texture} для цього матеріалу
          paintCanvasesRef.current.set(material, { canvas, ctx, texture });

          // Призначаємо CanvasTexture як material.map замість статичної
          const oldTexture = material.map;
          if (oldTexture) {
            oldTexture.dispose();
          }
          material.map = texture;
          material.needsUpdate = true;
        });
      });
    }

    // Функція для перемикання режиму малювання
    function setPaintMode(enabled: boolean) {
      isPaintModeRef.current = enabled;

      // Перериваємо поточний мазок і міняємо курсор
      paintStateRef.current.isPainting = false;
      paintStateRef.current.last = null;
      if (rendererRef.current) {
        rendererRef.current.domElement.style.cursor = enabled ? 'crosshair' : 'default';
      }

      if (enabled) {
        // При увімкненні режиму малювання — ініціалізуємо canvas для кожного матеріалу
        initializePaintCanvasesForModel();
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
      </div>
    );
  }
);