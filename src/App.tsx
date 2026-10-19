import { useState, useRef } from 'react';
import { Scene } from './components/Scene';
import Sidebar from './components/Sidebar';
import LayersPanel from './components/LayersPanel';
import { createLayer, type Layer, type LayerType } from './layers';

function App() {
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);
  const [paintMode, setPaintMode] = useState(false);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(24);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [brushSpace, setBrushSpace] = useState<'screen' | 'model'>('screen');
  // Одразу є один шар "Малювання", щоб можна було малювати без зайвих кроків
  const [layers, setLayers] = useState<Layer[]>(() => [createLayer('paint', [])]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(() => null);
  const activeId = activeLayerId ?? layers[layers.length - 1]?.id ?? null;
  const sceneRef = useRef<{
    loadModelFromFile: (file: File) => void;
    applyTextureToChannel: (channel: 'map' | 'roughnessMap' | 'metalnessMap' | 'normalMap' | 'emissiveMap', file: File) => void;
    setPaintMode: (enabled: boolean) => void;
  }>(null);

  const addLayer = (type: LayerType) => {
    const layer = createLayer(type, layers);
    setLayers([...layers, layer]);
    setActiveLayerId(layer.id);
  };

  const deleteLayer = (id: string) => {
    const next = layers.filter((l) => l.id !== id);
    setLayers(next);
    if (activeId === id) setActiveLayerId(next[next.length - 1]?.id ?? null);
  };

  const toggleVisible = (id: string) =>
    setLayers(layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)));

  return (
    <div className="h-screen w-screen bg-gray-900 flex overflow-hidden">
        <Sidebar
          cubeColor={cubeColor}
          cubeSize={cubeSize}
          paintMode={paintMode}
          brushColor={brushColor}
          brushSize={brushSize}
          tool={tool}
          onToolChange={setTool}
          brushSpace={brushSpace}
          onBrushSpaceChange={setBrushSpace}
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
          brushSpace={brushSpace}
          tool={tool}
          layers={layers}
          activeLayerId={activeId}
        />
      </main>
      <LayersPanel
        layers={layers}
        activeLayerId={activeId}
        onAdd={addLayer}
        onSelect={setActiveLayerId}
        onToggleVisible={toggleVisible}
        onDelete={deleteLayer}
      />
    </div>
  );
}

export default App;
