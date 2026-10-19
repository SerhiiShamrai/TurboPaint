import { useState, useRef } from 'react';
import { Scene, type SceneRef } from './components/Scene';
import Sidebar from './components/Sidebar';
import LayersPanel from './components/LayersPanel';
import { saveBlob, saveFiles } from './saveFiles';
import { packProject, unpackProject } from './project';
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
  const sceneRef = useRef<SceneRef>(null);

  const exportTextures = async () => {
    const files = await sceneRef.current?.exportAlbedo();
    if (files && files.length > 0) await saveFiles(files, 'textures.zip');
  };

  const saveProject = async () => {
    const snapshot = await sceneRef.current?.exportProject();
    if (!snapshot) return;
    const blob = packProject(snapshot, {
      cubeColor,
      cubeSize,
      layers,
      activeLayerId: activeId,
      brush: { color: brushColor, size: brushSize, space: brushSpace, tool },
    });
    await saveBlob(blob, 'project.tpaint', 'Проєкт TurboPainter', 'application/octet-stream');
  };

  const openProject = async (file: File) => {
    try {
      const { snapshot, settings } = unpackProject(await file.arrayBuffer());
      await sceneRef.current?.importProject(snapshot, {
        cubeColor: settings.cubeColor,
        cubeSize: settings.cubeSize,
        layers: settings.layers,
        activeLayerId: settings.activeLayerId,
      });
      setCubeColor(settings.cubeColor);
      setCubeSize(settings.cubeSize);
      setLayers(settings.layers);
      setActiveLayerId(settings.activeLayerId);
      setBrushColor(settings.brush.color);
      setBrushSize(settings.brush.size);
      setBrushSpace(settings.brush.space);
      setTool(settings.brush.tool);
    } catch (e) {
      alert(`Не вдалося відкрити проєкт: ${e instanceof Error ? e.message : 'невідома помилка'}`);
    }
  };

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
          onExportTextures={exportTextures}
          onSaveProject={saveProject}
          onOpenProject={openProject}
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
