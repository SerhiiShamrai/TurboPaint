import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls';

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
  // Рефери на DOM елементи
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js об'єкти
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let controls: OrbitControls | null = null;
  let cubeMesh: THREE.Mesh | null = null;

  // State для масштабу (синхронізація з Sidebar)
  const [scale, setScale] = useState(1);

  // Ініціалізація сцени
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Створення сцени
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // 2. Камера
    camera = new THREE.PerspectiveCamera(
      75,
      (containerRef.current.clientWidth / containerRef.current.clientHeight),
      0.1,
      1000
    );
    camera.position.set(3, 3, 3);

    // 3. Рендерер
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    // 4. OrbitControls (авто-обертання ВІМКНЕНЕ)
    controls = new OrbitControls(camera, renderer.domElement as any);
    controls.autoRotate = false; // FIX: Авто-обертання вимкнено
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

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
    cubeMesh = new THREE.Mesh(geometry, material);
    scene.add(cubeMesh);

    // Анімаційний цикл
    function animate() {
      requestAnimationFrame(animate);
      
      controls?.update(); // Оновлення контролів (для damping)
      
      if (renderer && camera && scene) {
        renderer.render(scene, camera);
      }
    }

    animate();

    // 7. Обробка змін розміру вікна
    function onWindowResize() {
      if (!containerRef.current || !camera || !renderer) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    window.addEventListener('resize', onWindowResize);

    // 8. ResizeObserver для контейнера (якщо він змінює розмір)
    if (containerRef.current) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            onWindowResize();
          }
        }
      });
      observer.observe(containerRef.current);
    }

    // Зберігаємо сцену в ref для доступу ззовні
    (containerRef.current as any).__scene = scene;
    (containerRef.current as any).__camera = camera;
    (containerRef.current as any).__renderer = renderer;

    return () => {
      window.removeEventListener('resize', onWindowResize);
      
      // Очищення
      if (containerRef.current) {
        containerRef.current.removeChild(renderer?.domElement);
      }
    };
  }, []);

  // FIX: Синхронізація кольору кубу з props
  useEffect(() => {
    if (!cubeMesh || !scene) return;

    (cubeMesh.material as any).color.set(cubeColor);
  }, [cubeColor]);

  // FIX: Синхронізація масштабу кубу з props (через setScale)
  useEffect(() => {
    if (!cubeMesh) return;

    setScale(cubeSize);
  }, [cubeSize]);

  // FIX: Застосування масштабу при зміні scale state
  useEffect(() => {
    if (!cubeMesh) return;

    cubeMesh.scale.set(scale, scale, scale);
  }, [scale]);

  return (
    <div ref={containerRef} className="flex-1 h-screen relative">
      {/* Заголовок */}
      <div className="absolute top-4 left-4 bg-gray-800/90 backdrop-blur-sm rounded-lg p-4 shadow-lg border border-gray-700">
        <h1 className="text-white font-bold text-lg mb-2">{title}</h1>
        
        {/* Інструкція */}
        <div className="bg-gray-700/80 rounded p-3 mb-4">
          <p className="text-gray-300 text-xs">{instruction}</p>
        </div>

        {/* Налаштування кубу */}
        <div className="space-y-3">
          {/* Колір */}
          <div>
            <label className="text-gray-300 text-xs block mb-1">Колір:</label>
            <input
              type="color"
              value={cubeColor.toString(16).padStart(6, '0')}
              onChange={(e) => {
                const color = parseInt(e.target.value, 16);
                const materialColor = new THREE.Color(color);
                (cubeMesh?.material as any).color.set(materialColor);
              }}
              className="w-full h-8 rounded cursor-pointer border border-gray-600"
            />
          </div>

          {/* Розмір */}
          <div>
            <label className="text-gray-300 text-xs block mb-1">Розмір: {scale.toFixed(1)}</label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>

          {/* Кнопка скидання */}
          <button
            onClick={() => {
              setScale(1);
                const neutralColor = new THREE.Color(0x888888);
                (cubeMesh?.material as any).color.set(neutralColor);
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors w-full"
          >
            Скинути налаштування
          </button>
        </div>
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
  );
}

export default Scene;