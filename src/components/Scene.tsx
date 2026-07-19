import { useEffect, useRef } from 'react';
import * as THREE from 'three';
// --- Власний орбітальний контролер камери (замість OrbitControls) ---

/**
 * TurboPainter MVP - 3D сцена з кубом
 * 
 * Функціонал:
 * - Орбітальні контролі (обертання, зум, переміщення)
 * - Налаштування розміру та кольору кубу через props
 * - Авто-обертання вимкнено
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
}

function Scene({ 
  title = '3D Сцена', 
  instruction = 'Ліва кнопка — обертати, колесо — зумувати',
  cubeColor = 0x888888,
  cubeSize = 1
}: SceneProps) {
  // Рефери на DOM елементи та Three.js об'єкти
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // --- Змінні для власного контролера камери ---
  let radius = 6;
  let theta = Math.PI / 4;
  let phi = Math.PI / 3;
  const panOffset = new THREE.Vector3(0, 0, 0);
  const MIN_PHI = 0.1;
  const MAX_PHI = Math.PI - 0.1;
  const MIN_RADIUS = 2;
  const MAX_RADIUS = 20;

  // Функція оновлення камери з орбітальної позиції
  function updateCameraFromOrbit() {
    const cam = cameraRef.current;
    if (!cam) return;
    const pivot = cubeMeshRef.current ? cubeMeshRef.current.position : new THREE.Vector3();
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);
    const lookAtPoint = pivot.clone().add(panOffset);
    cam.position.set(lookAtPoint.x + x, lookAtPoint.y + y, lookAtPoint.z + z);
    cam.lookAt(lookAtPoint);
  }

  // Події для контролера
  let isRotating = false;
  let isPanningNow = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button === 0) isRotating = true;
    if (e.button === 2) isPanningNow = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onPointerUp() {
    isRotating = false;
    isPanningNow = false;
  }
  function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (isRotating) {
      theta -= dx * 0.005;
      phi -= dy * 0.005;
      phi = Math.max(MIN_PHI, Math.min(MAX_PHI, phi));
    }

    if (isPanningNow) {
      const cam = cameraRef.current;
      if (!cam) return;
      const panSpeed = radius * 0.0015;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      panOffset.addScaledVector(right, -dx * panSpeed);
      panOffset.addScaledVector(up, dy * panSpeed);
    }
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    radius += e.deltaY * 0.01;
    radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
  }
  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
  }

  const cubeMeshRef = useRef<THREE.Mesh | null>(null);

  // Ініціалізація сцени
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Створення сцени
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    sceneRef.current = scene;

    // 2. Камера
    const camera = new THREE.PerspectiveCamera(
      75,
      (containerRef.current!.clientWidth / containerRef.current!.clientHeight),
      0.1,
      1000
    );
    camera.position.set(3, 3, 3);
    cameraRef.current = camera;

    // 3. Рендерер
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current!.clientWidth, containerRef.current!.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    containerRef.current!.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Підписка на події власного контролера
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    // 4. Створення куба (MeshStandardMaterial для реакції на світло)
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
      color: cubeColor,
      roughness: 0.5,
      metalness: 0.1
    });
    const cubeMesh = new THREE.Mesh(geometry, material);
    scene.add(cubeMesh);
    cubeMeshRef.current = cubeMesh;

    // 5. Освітлення (для StandardMaterial)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // Анімаційний цикл
    function animate() {
      requestAnimationFrame(animate);

      // Оновлення камери з орбітальної позиції
      updateCameraFromOrbit();

      if (cubeMeshRef.current) {
        // Точка обертання завжди дорівнює позиції куба
        const pivot = cubeMeshRef.current.position.clone();
        camera.lookAt(pivot);
      }

      if (renderer && camera && scene) {
        renderer.render(scene, camera);
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

    // 8. ResizeObserver для контейнера (якщо він змінює розмір)
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

    // Зберігаємо сцену в ref для доступу ззовні
    (containerRef.current as any).__scene = sceneRef.current;
    (containerRef.current as any).__camera = cameraRef.current;
    (containerRef.current as any).__renderer = rendererRef.current;

    return () => {
      // Видалення обробників подій власного контролера
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);

      window.removeEventListener('resize', onWindowResize);
      observer.disconnect();
      
      // Очищення рендерера
      if (rendererRef.current && rendererRef.current.domElement?.parentElement) {
        rendererRef.current.domElement.parentElement.removeChild(rendererRef.current.domElement);
      }
    };
  }, []);

  // Синхронізація кольору кубу з props
  useEffect(() => {
    if (!cubeMeshRef.current || !sceneRef.current) return;

    (cubeMeshRef.current.material as any).color.set(cubeColor);
  }, [cubeColor]);

  // Синхронізація розміру кубу з props
  useEffect(() => {
    if (!cubeMeshRef.current || !sceneRef.current) return;

    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    cubeMeshRef.current.geometry.dispose();
    cubeMeshRef.current.geometry = geometry;
  }, [cubeSize]);

  return (
<div ref={containerRef} className="absolute inset-0 w-full h-full">
      {/* Заголовок */}
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

export default Scene;
