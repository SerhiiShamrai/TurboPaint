import { useState } from 'react';

/**
 * TurboPainter MVP - Бокова панель керування
 * 
 * Функціонал:
 * - Інформація про сцену
 * - Налаштування куба (колір, розмір)
 * - Кнопки для швидких дій
 */

interface SidebarProps {
  /** Заголовок панелі */
  title?: string;
}

function Sidebar({ title = 'Панель керування' }: SidebarProps) {
  // Стан куба
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);

  // Синхронізація з Scene через props (якщо потрібно)
  const updateSceneColor = (color: number) => {
    setCubeColor(color);
  };

  const updateSceneSize = (size: number) => {
    setCubeSize(size);
  };

  return (
    <div className="w-64 bg-gray-800 h-screen p-4 flex flex-col gap-4">
      {/* Заголовок */}
      <div>
        <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
        <p className="text-gray-400 text-sm">
          TurboPainter MVP — WebGL 3D Editor
        </p>
      </div>

      {/* Інструкція */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Інструкція:</h3>
        <ul className="text-gray-300 text-xs space-y-1">
          <li>• Ліва кнопка — обертати камеру</li>
          <li>• Колесо миші — зумувати</li>
          <li>• Права кнопка — переміщати</li>
        </ul>
      </div>

      {/* Налаштування куба */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Налаштування куба:</h3>
        
        {/* Колір */}
        <div className="mb-3">
          <label className="text-gray-300 text-xs block mb-1">Колір:</label>
          <input
            type="color"
            value={cubeColor.toString(16).padStart(6, '0')}
            onChange={(e) => setCubeColor(parseInt(e.target.value, 16))}
            className="w-full h-8 rounded cursor-pointer"
          />
        </div>

        {/* Розмір */}
        <div>
          <label className="text-gray-300 text-xs block mb-1">Розмір: {cubeSize.toFixed(1)}</label>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={cubeSize}
            onChange={(e) => setCubeSize(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Інформація */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Інформація:</h3>
        <div className="text-gray-400 text-xs space-y-1">
          <p>• Three.js 0.170</p>
          <p>• React + Vite</p>
          <p>• TailwindCSS</p>
        </div>
      </div>

      {/* Кнопка рестарту */}
      <button
        onClick={() => {
          setCubeColor(0x888888);
          setCubeSize(1);
        }}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
      >
        Скинути налаштування
      </button>
    </div>
  );
}

export default Sidebar;