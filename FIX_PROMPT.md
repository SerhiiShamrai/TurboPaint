# Промпт для виправлення проблеми зі скролінгом у TurboPainter

## Проблема
Сторінка постійно скролиться вниз, і не видно 3D вьюпорт. Проєкт: React + Vite + Three.js + TailwindCSS.

## Кореневі причини (вже діагностовані)

### Причина 1: Відсутність CSS reset для html/body
Файл `src/index.css` містить тільки `@import "tailwindcss"`. Браузерні стилі за замовчуванням додають margin/padding до body, а html не має контролю overflow.

### Причина 2: Конфлікт `min-h-screen` + вкладені `h-screen`
У `App.tsx`:
- Кореневий div має `min-h-screen` (мінімум 100vh, може рости)
- `<Sidebar>` має `h-screen` (жорстко 100vh)
- `<main>` має `flex-1 h-screen` (жорстко 100vh)
- Це створює конфлікт: flex-контейнер з min-h-screen + діти з h-screen = потенційний overflow

### Причина 3: Дублювання `h-screen` у Scene.tsx
Компонент Scene (`src/components/Scene.tsx`) має `flex-1 h-screen relative` на контейнері. `flex-1` вже розтягує елемент на доступний простір, але `h-screen` примусово ставить 100vh, що виходить за межі батьківського `<main>`.

### Причина 4: Three.js canvas без CSS контролю
Canvas додається через JS `appendChild`, але не має CSS правил `position: absolute; top: 0; left: 0; width: 100%; height: 100%`. Це може викликати layout shift.

### Причина 5: Absolute елементи в Scene викликають layout recalculations
Два absolute-позиціоновані div'и в Scene (заголовок та інфо-панель) можуть викликати перерахунок layout при рендерингу.

---

## Виправлення

### Файл 1: `src/index.css`

Додати CSS reset та блокування скролінгу на рівні html/body:

```css
@import "tailwindcss";

/* CSS Reset для блокування скролінгу */
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden; /* Блокуємо скролінг */
}

#root {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

### Файл 2: `src/App.tsx`

Замінити `min-h-screen` на `h-screen overflow-hidden` для кореневого div. Прибрати зайві `h-screen` з дочірніх елементів, оскільки вони вже розтягуються через flex:

```tsx
import { useState } from 'react';
import Scene from './components/Scene';
import Sidebar from './components/Sidebar';

function App() {
  const [cubeColor, setCubeColor] = useState(0x888888);
  const [cubeSize, setCubeSize] = useState(1);

  return (
    <div className="h-screen w-screen bg-gray-900 flex overflow-hidden">
      {/* Бокова панель */}
      <Sidebar 
        cubeColor={cubeColor}
        cubeSize={cubeSize}
        onColorChange={setCubeColor}
        onSizeChange={setCubeSize}
      />
      
      {/* Основна сцена */}
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
```

**Ключові зміни:**
- `min-h-screen` → `h-screen w-screen overflow-hidden` (фіксована висота, без скролу)
- `<main className="flex-1 h-screen">` → `<main className="flex-1 relative overflow-hidden">` (прибрано h-screen, додано relative для контексту позиціонування)

### Файл 3: `src/components/Sidebar.tsx`

Замінити `h-screen` на `h-full`, щоб sidebar займав 100% висоти батька, а не 100vh:

```tsx
// Замінити рядок 34:
<div className="w-64 bg-gray-800 h-full flex flex-col gap-4 overflow-y-auto">
```

**Ключові зміни:**
- `h-screen` → `h-full` (висота відносно батька, не viewport)
- Додано `overflow-y-auto` (якщо контент перевищить висоту, буде скрол тільки всередині сайдбару)

### Файл 4: `src/components/Scene.tsx`

Замінити `h-screen` на `h-full` у контейнері. Додати CSS для canvas елемента Three.js:

```tsx
// Замінити рядок 164:
<div ref={containerRef} className="flex-1 h-full w-full relative overflow-hidden">
```

Також у `useEffect`, після створення рендерера (рядок 63), додати inline стилі для canvas:

```tsx
// Після рядка 63 (rendererRef.current = renderer;):
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
```

**Ключові зміни:**
- `h-screen` → `h-full w-full` (висота відносно батька)
- Canvas фіксується через absolute positioning всередині контейнера

---

## Підсумок змін

| Файл | Проблема | Виправлення |
|------|----------|-------------|
| `src/index.css` | Немає CSS reset | Додати `overflow: hidden` для html, body, #root |
| `src/App.tsx` | `min-h-screen` дозволяє ріст | `h-screen overflow-hidden` |
| `src/App.tsx` | `<main>` має `h-screen` | Прибрати `h-screen`, залишити `flex-1` |
| `src/components/Sidebar.tsx` | `h-screen` = 100vh жорстко | `h-full` = 100% від батька |
| `src/components/Scene.tsx` | `h-screen` = 100vh жорстко | `h-full` = 100% від батька |
| `src/components/Scene.tsx` | Canvas без CSS контролю | Додати `position: absolute` стилі |

## Перевірка після виправлення
1. Сторінка не повинна скролитися взагалі
2. 3D вьюпорт повинен займати весь простір праворуч від сайдбару
3. При зміні розміру вікна все повинно коректно масштабуватися
4. Сайдбар повинен бути фіксований зліва (256px ширина)