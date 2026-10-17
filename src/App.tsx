import { useState, useRef } from 'react';
import { Scene } from './components/Scene';
import Sidebar from './components/Sidebar';

function App() {
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);
  const [paintMode, setPaintMode] = useState(false);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(24);
  const sceneRef = useRef<{ 
    loadModelFromFile: (file: File) => void;
    applyTextureToChannel: (channel: 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'emissiveMap', file: File) => void;
    setPaintMode: (enabled: boolean) => void;
  }>(null);

  return (
    <div className="h-screen w-screen bg-gray-900 flex overflow-hidden">
        <Sidebar
          cubeColor={cubeColor}
          cubeSize={cubeSize}
          paintMode={paintMode}
          brushColor={brushColor}
          brushSize={brushSize}
          onBrushColorChange={setBrushColor}
          onBrushSizeChange={setBrushSize}
          onColorChange={setCubeColor}
          onSizeChange={setCubeSize}
          onPaintModeChange={(enabled) => {
            setPaintMode(enabled);
            sceneRef.current?.setPaintMode(enabled);
          }}
          onLoadModel={(file) => sceneRef.current?.loadModelFromFile(file)}
          onLoadTexture={(channel, file) => sceneRef.current?.applyTextureToChannel(channel, file)}
        />
      <main className="flex-1 relative overflow-hidden">
        <Scene
          ref={sceneRef}
          title="TurboPainter MVP"
          instruction="Ліва кнопка — обертати, колесо — зумувати"
          cubeColor={cubeColor}
          cubeSize={cubeSize}
          brushColor={brushColor}
          brushSize={brushSize}
        />
      </main>
    </div>
  );
}

export default App;
