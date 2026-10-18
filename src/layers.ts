/** Тип шару. Поки що є лише "Малювання"; інші типи додамо пізніше. */
export type LayerType = 'paint';

export const LAYER_TYPE_LABELS: Record<LayerType, string> = {
  paint: 'Малювання',
};

export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
}

let counter = 0;

export function createLayer(type: LayerType, existing: Layer[]): Layer {
  counter += 1;
  const sameType = existing.filter((l) => l.type === type).length;
  const label = LAYER_TYPE_LABELS[type];
  return {
    id: `layer-${Date.now().toString(36)}-${counter}`,
    type,
    name: sameType === 0 ? label : `${label} ${sameType + 1}`,
    visible: true,
  };
}
