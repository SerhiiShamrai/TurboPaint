import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  const controlsRef = useRef<OrbitControls | null>(null);
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

    // 4. OrbitControls (авто-обертання ВІМКНЕНЕ)
    const controls = new OrbitControls(camera, renderer.domElement as any);
    controls.autoRotate = false; // FIX: Авто-обертання вимкнено
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // 5. Освітлення (для StandardMaterial)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7);
    scene.add(directionalLight);

    // 6. Створення куба (MeshStandardMaterial для реакції на світло)
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
      color: cubeColor,
      roughness: 0.5,
      metalness: 0.1
    });
    const cubeMesh = new THREE.Mesh(geometry, material);
    scene.add(cubeMesh);
    cubeMeshRef.current = cubeMesh;

    // Анімаційний цикл
    function animate() {
      requestAnimationFrame(animate);

      controls.update();

      // Точка обертання ЗАВЖДИ дорівнює позиції куба — без винятків і без затримки.
      // Права кнопка миші й далі рухає камеру (пан видно), але сам об'єкт
      // залишається незмінною віссю обертання щокадру.
      if (cubeMeshRef.current) {
        controls.target.copy(cubeMeshRef.current.position);
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
    (containerRef.current as any).__controls = controlsRef.current;

    return () => {
      window.removeEventListener('resize', onWindowResize);
      observer.disconnect();
      
      // Очищення
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
