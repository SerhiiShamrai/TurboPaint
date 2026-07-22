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
  /** Колір кубу (hex) */
  cubeColor?: number;
  /** Розмір кубу */
  cubeSize?: number;
  /** Поточний стан режиму малювання */
  paintMode?: boolean;
  /** Callback при зміні кольору */
  onColorChange?: (color: number) => void;
  /** Callback при зміні розміру */
  onSizeChange?: (size: number) => void;
  /** Callback для завантаження моделі */
  onLoadModel?: (file: File) => void;
  /** Callback для завантаження текстури на канал матеріалу */
  onLoadTexture?: (channel: 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'emissiveMap', file: File) => void;
  /** Callback для перемикання режиму малювання */
  onPaintModeChange?: (enabled: boolean) => void;
}

export interface PaintModeMethods {
  setPaintMode(enabled: boolean): void;
}

function Sidebar({ 
  title = 'Панель керування', 
  cubeColor = 0x888888,
  cubeSize = 1,
  paintMode,
  onColorChange,
  onSizeChange,
  onLoadModel,
  onLoadTexture,
  onPaintModeChange
}: SidebarProps) {

  return (
<div className="w-64 bg-gray-800 h-full p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Заголовок */}
      <div>
        <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
        <p className="text-gray-400 text-sm">
          TurboPainter MVP — WebGL 3D Editor
        </p>
      </div>

      {/* Кнопка перемикання режиму малювання */}
      <button
        onClick={() => onPaintModeChange?.(!paintMode)}
        className={`w-full font-semibold py-2 px-4 rounded transition-colors ${
          paintMode 
            ? 'bg-purple-600 hover:bg-purple-700 text-white' 
            : 'bg-gray-600 hover:bg-gray-700 text-gray-300'
        }`}
      >
        {paintMode ? '🔄 Режим огляду' : '🖌 Режим малювання'}
      </button>

      {/* Інструкція */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Інструкція:</h3>
        <ul className="text-gray-300 text-xs space-y-1">
          {paintMode ? (
            <>
              <li>• Ліва кнопка — малювати</li>
              <li>• Середня кнопка — обертати камеру</li>
              <li>• Права кнопка — переміщати</li>
            </>
          ) : (
            <>
              <li>• Ліва кнопка — обертати камеру</li>
              <li>• Колесо миші — зумувати</li>
              <li>• Права кнопка — переміщати</li>
            </>
          )}
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
            value={`#${cubeColor.toString(16).padStart(6, '0')}`}
            onChange={(e) => {
              const color = parseInt(e.target.value.slice(1), 16);
              onColorChange?.(color);
            }}
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
            onChange={(e) => {
              const size = parseFloat(e.target.value);
              onSizeChange?.(size);
            }}
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

      {/* Кнопка завантаження моделі */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Завантажити модель:</h3>
        <input
          type="file"
          accept=".glb,.gltf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onLoadModel) {
              onLoadModel(file);
              // Скинути input, щоб можна було завантажити той самий файл знову
              e.target.value = '';
            }
          }}
          className="hidden"
          id="model-file-input"
        />
        <label
          htmlFor="model-file-input"
          className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded cursor-pointer transition-colors inline-block"
        >
          Load Model
        </label>
      </div>

      {/* Секція матеріалів */}
      <div className="bg-gray-700 rounded-lg p-3">
        <h3 className="text-white font-semibold mb-2 text-sm">Матеріали:</h3>
        
        {/* Albedo (map) */}
        <div className="mb-2">
          <label className="text-gray-300 text-xs block mb-1">Albedo (map):</label>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLoadTexture) {
                onLoadTexture('map', file);
                e.target.value = '';
              }
            }}
            className="hidden"
            id="albedo-file-input"
          />
          <label
            htmlFor="albedo-file-input"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded cursor-pointer transition-colors inline-block text-xs"
          >
            Завантажити Albedo
          </label>
        </div>

        {/* Roughness */}
        <div className="mb-2">
          <label className="text-gray-300 text-xs block mb-1">Roughness:</label>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLoadTexture) {
                onLoadTexture('roughnessMap', file);
                e.target.value = '';
              }
            }}
            className="hidden"
            id="roughness-file-input"
          />
          <label
            htmlFor="roughness-file-input"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded cursor-pointer transition-colors inline-block text-xs"
          >
            Завантажити Roughness
          </label>
        </div>

        {/* Metalness */}
        <div className="mb-2">
          <label className="text-gray-300 text-xs block mb-1">Metalness:</label>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLoadTexture) {
                onLoadTexture('metalnessMap', file);
                e.target.value = '';
              }
            }}
            className="hidden"
            id="metalness-file-input"
          />
          <label
            htmlFor="metalness-file-input"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded cursor-pointer transition-colors inline-block text-xs"
          >
            Завантажити Metalness
          </label>
        </div>

        {/* Normal */}
        <div className="mb-2">
          <label className="text-gray-300 text-xs block mb-1">Normal:</label>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLoadTexture) {
                onLoadTexture('normalMap', file);
                e.target.value = '';
              }
            }}
            className="hidden"
            id="normal-file-input"
          />
          <label
            htmlFor="normal-file-input"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded cursor-pointer transition-colors inline-block text-xs"
          >
            Завантажити Normal
          </label>
        </div>

        {/* Emission */}
        <div className="mb-2">
          <label className="text-gray-300 text-xs block mb-1">Emission:</label>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && onLoadTexture) {
                onLoadTexture('emissiveMap', file);
                e.target.value = '';
              }
            }}
            className="hidden"
            id="emission-file-input"
          />
          <label
            htmlFor="emission-file-input"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded cursor-pointer transition-colors inline-block text-xs"
          >
            Завантажити Emission
          </label>
        </div>
      </div>

      {/* Кнопка рестарту */}
      <button
        onClick={() => {
          onColorChange?.(0x888888);
          onSizeChange?.(1);
        }}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
      >
        Скинути налаштування
      </button>
    </div>
  );
}

export default Sidebar;
