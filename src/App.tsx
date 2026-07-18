// TurboPainter MVP - Основний компонент
// Імпорт Scene компонента з Three.js сценою та Sidebar для UI

import { useState } from 'react';
import Scene from './components/Scene';
import Sidebar from './components/Sidebar';

function App() {
  // Стан для синхронізації між Sidebar та Scene
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Бокова панель */}
      <Sidebar />
      
      {/* Основна сцена */}
      <main className="flex-1 h-screen">
        <Scene 
          title="TurboPainter MVP" 
          instruction="Ліва кнопка — обертати, колесо — зумувати"
          cubeColor={cubeColor}
          cubeSize={cubeSize}
        />
      </main>
    </div>
  );
}

export default App;
