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
}

interface SceneRef {
  loadModelFromFile: (file: File) => void;
}

export const Scene = forwardRef<SceneRef, SceneProps>(
  function Scene({ 
    title = '3D Сцена', 
    instruction = "Left mouse button — rotate camera, right mouse button — pan view, scroll wheel — zoom",
    cubeColor = 0x888888,
    cubeSize = 1,
    modifierInstruction = "Middle mouse or Alt+LMB — pan, Left mouse — rotate",
    onModelLoad = undefined,
  }: SceneProps, ref) {
    // Рефи на DOM елементи та Three.js об'єкти
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const currentModelRef = useRef<THREE.Object3D | null>(null);

    // --- Стан контролера камери (зберігається в useRef для збереження між рендерами) ---
    const controllerState = useRef({
      // Сферичні координати
      radius: 6,
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
    const MIN_RADIUS = 2;
    const MAX_RADIUS = 20;

    // --- Обробники подій миші ---

    function onPointerDown(e: PointerEvent) {
      const state = controllerState.current;
      
      if (e.button === 0) {     // Ліва кнопка — обертання навколо об'єкта
        state.isRotating = true;
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
      // Reset pan accumulation when releasing right button (as per requirement)
    }

    function onPointerMove(e: PointerEvent) {
      const state = controllerState.current;

      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
    
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
      const zoomSensitivity = 0.005;
      state.radius += e.deltaY * zoomSensitivity;
      state.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, state.radius));
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

    // Функція завантаження моделі з файлу
    function loadModelFromFile(file: File) {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;
        
        new GLTFLoader().parse(arrayBuffer, '', (gltf) => {
          const gltfScene = gltf.scene;
          
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
          
          // е) Оновлюємо камеру одразу після зміни
          updateCameraFromOrbit();
          
          // Повідомляємо батька про завантаження моделі
          onModelLoad?.(file);
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
      const geometry = new THREE.BoxGeometry(1, 1, 1);
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

    // Синхронізація кольору моделі з props
    useEffect(() => {
      if (!currentModelRef.current) return;
      
      // Знаходимо перший mesh у сцені для зміни кольору
      let firstMesh: THREE.Mesh | null = null;
      currentModelRef.current.traverse((child: any) => {
        if (child.isMesh && !firstMesh) {
          firstMesh = child;
        }
      });
      
      if (firstMesh) {
        const meshMaterial = firstMesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
        if (Array.isArray(meshMaterial)) {
          meshMaterial.forEach(m => {
            (m as THREE.MeshStandardMaterial).color.set(cubeColor);
          });
        } else {
          (meshMaterial as THREE.MeshStandardMaterial).color.set(cubeColor);
        }
      }
    }, [cubeColor]);

    // Синхронізація розміру моделі з props (Three.js R124+)
    useEffect(() => {
      if (!currentModelRef.current) return;
      
      // Знаходимо перший mesh у сцені для зміни геометрії
      let firstMesh: THREE.Mesh<any, any> | null = null;
      currentModelRef.current.traverse((child: any) => {
        if (child.isMesh && !firstMesh) {
          firstMesh = child;
        }
      });
      
      // Type assertion для обходу TypeScript обмежень при traversing
      if (firstMesh) {
        const mesh = firstMesh as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
        
        // У Three.js Mesh завжди має властивість material — це частина типу
        const material = mesh.material;
        
        // Матеріал може бути масивом або об'єктом
        if (Array.isArray(material)) {
          material[0].color.set(cubeColor);
        } else {
          material.color.set(cubeColor);
        }
        
        // Оновлюємо геометрію
        mesh.geometry.dispose();
        const newGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
        mesh.geometry = newGeometry;
      }
    }, [cubeSize]);

    useImperativeHandle(ref, () => ({ loadModelFromFile }));

    // --- Return JSX ---
    return (
      <div ref={containerRef} className="absolute inset-0 w-full h-full">
        <div className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-gray-700">
          <h1 className="text-white font-bold text-lg mb-2">{title}</h1>
          
          {/* Інструкція */}
          <div className="bg-gray-700/80 rounded p-3 mb-4">
            <p className="text-gray-300 text-xs">{instruction}</p>
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