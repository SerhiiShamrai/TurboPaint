import { useState } from 'react';
import Scene from './components/Scene';
import Sidebar from './components/Sidebar';

function App() {
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);

  return (
    <div className="h-screen w-screen bg-gray-900 flex overflow-hidden">
      <Sidebar
        cubeColor={cubeColor}
        cubeSize={cubeSize}
        onColorChange={setCubeColor}
        onSizeChange={setCubeSize}
      />
      <main className="flex-1 relative overflow-hidden">
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