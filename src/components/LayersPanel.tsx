import { LAYER_TYPE_LABELS, type Layer, type LayerType } from '../layers';

interface LayersPanelProps {
  /** Шари знизу вгору (у списку показуємо зверху — найвищий) */
  layers: Layer[];
  activeLayerId: string | null;
  onAdd: (type: LayerType) => void;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
}

function LayersPanel({ layers, activeLayerId, onAdd, onSelect, onToggleVisible, onDelete }: LayersPanelProps) {
  const shown = [...layers].reverse();

  return (
    <div className="w-60 bg-gray-800 h-full p-4 flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Шари</h2>
        <button
          onClick={() => onAdd('paint')}
          title={`Додати шар "${LAYER_TYPE_LABELS.paint}"`}
          className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold py-1 px-3 rounded"
        >
          + Додати
        </button>
      </div>

      {shown.length === 0 && (
        <p className="text-gray-400 text-xs">
          Шарів немає. Додайте шар "{LAYER_TYPE_LABELS.paint}", щоб малювати.
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {shown.map((layer) => {
          const active = layer.id === activeLayerId;
          return (
            <li
              key={layer.id}
              data-testid="layer-row"
              data-active={active}
              onClick={() => onSelect(layer.id)}
              className={`flex items-center gap-2 rounded px-2 py-2 cursor-pointer text-sm ${
                active ? 'bg-purple-700 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
            >
              <button
                title={layer.visible ? 'Вимкнути видимість' : 'Увімкнути видимість'}
                aria-label="Видимість"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(layer.id);
                }}
                className={`w-6 text-center ${layer.visible ? '' : 'opacity-40'}`}
              >
                {layer.visible ? '👁' : '🚫'}
              </button>
              <span className={`flex-1 truncate ${layer.visible ? '' : 'opacity-50 line-through'}`}>
                {layer.name}
              </span>
              <button
                title="Видалити шар"
                aria-label="Видалити"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(layer.id);
                }}
                className="w-6 text-center hover:text-red-300"
              >
                🗑
              </button>
            </li>
          );
        })}
      </ul>

      {layers.length > 0 && !layers.find((l) => l.id === activeLayerId)?.visible && (
        <p className="text-yellow-300 text-xs">
          Активний шар вимкнений або не вибраний — малювання не працює.
        </p>
      )}
    </div>
  );
}

export default LayersPanel;
