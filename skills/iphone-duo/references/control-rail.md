# Custom control rail (R3.2 + R4): reference implementation

Use only when native header/toolbar items are not enough. One provider at the app root (outside the `Stack`), screens register their buttons. Because the rail lives outside the screens, it does not move with the screen's push/pop animation, and an old and a new button can swap at the same moment.
Check the Reanimated builder names against the installed version (SKILL.md §7). All comments below are in Ukrainian because that is the project's comment language; follow `pl conventions` in the real project.

```tsx
// src/rail/ControlRail.tsx
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SlideInLeft, SlideInRight, SlideOutLeft, SlideOutRight, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';

/** Розмір кнопки панелі (зона натискання) і відступ між кнопками, pt. */
const BUTTON_SIZE = 48;
const BUTTON_GAP = 8;

/** Опис однієї кнопки панелі керування. */
export type RailControl = {
  id: string; // унікальний id кнопки: однакові id на сусідніх екранах не анімуються повторно
  slot: 'top' | 'bottom'; // група: закріплена зверху чи знизу колонки
  icon: React.ReactNode; // іконка (SF Symbol або власна)
  label: string; // accessibilityLabel: обовʼязковий для іконок
  onPress: () => void; // дія кнопки
};

/** Контекст: поточний набір кнопок і функція його заміни. */
const RailContext = createContext<{ setControls: (c: RailControl[]) => void }>({ setControls: () => {} });

/** Реєструє кнопки поточного екрана, поки екран у фокусі; при втраті фокусу кнопки не чіпає (їх замінить наступний екран). */
export function useRailControls(controls: RailControl[]) {
  const { setControls } = useContext(RailContext); // функція заміни набору кнопок
  useFocusEffect(useCallback(() => { setControls(controls); }, [setControls, controls]));
}

/** Провайдер: тримає набір кнопок і малює панель поверх застосунку. Ставиться в кореневому layout поза Stack. */
export function ControlRailProvider({ children, fallback }: { children: React.ReactNode; fallback?: (c: RailControl[]) => React.ReactNode }) {
  const [controls, setControls] = useState<RailControl[]>([]); // активні кнопки
  const edge = useVerticalBarEdgeIOS(); // 'leading' | 'trailing' | null: системна панель активна, коли не null
  const insets = useSafeAreaInsets(); // відступи безпечної зони
  const reduced = useReducedMotion(); // користувач увімкнув «Зменшити рух»
  const value = useMemo(() => ({ setControls }), []);

  // фізична сторона панелі береться з відступів, а не з назви edge (у RTL панель лишається біля камери)
  const side: 'left' | 'right' = insets.right >= insets.left ? 'right' : 'left'; // сторона панелі
  const fromRight = side === 'right'; // кнопки випливають справа
  const gutter = Math.max(8, ((fromRight ? insets.right : insets.left) - BUTTON_SIZE) / 2); // відступ від краю: кнопка по центру панелі

  // анімації: поява й зникнення стартують в одному кадрі, без очікування (жодного режиму «wait»)
  const entering = reduced
    ? FadeIn.duration(120)
    : (fromRight ? SlideInRight : SlideInLeft).duration(220).easing(Easing.out(Easing.cubic));
  const exiting = reduced
    ? FadeOut.duration(100)
    : (fromRight ? SlideOutRight : SlideOutLeft).duration(160).easing(Easing.in(Easing.cubic));

  /** Позиція кнопки у фіксованому слоті: індекс усередині групи, групи закріплені зверху та знизу. */
  const place = (c: RailControl) => {
    const group = controls.filter((x) => x.slot === c.slot); // кнопки тієї ж групи
    const index = group.findIndex((x) => x.id === c.id); // номер слота в групі
    const offset = index * (BUTTON_SIZE + BUTTON_GAP); // зсув від краю групи
    return c.slot === 'top' ? { top: insets.top + offset } : { bottom: insets.bottom + offset };
  };

  return (
    <RailContext.Provider value={value}>
      {children}
      {edge === null
        ? fallback?.(controls) ?? null // системної панелі немає: класичне розташування (хедер/нижня панель)
        : controls.map((c) => (
          <Animated.View
            key={c.id}
            entering={entering}
            exiting={exiting}
            layout={reduced ? undefined : LinearTransition.duration(200)}
            style={[styles.button, place(c), fromRight ? { right: gutter } : { left: gutter }]}
            pointerEvents="box-none"
          >
            <Pressable accessibilityRole="button" accessibilityLabel={c.label} testID={`rail-${c.id}`} onPress={c.onPress}
              style={({ pressed }) => [styles.press, pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] }]}>
              {c.icon}
            </Pressable>
          </Animated.View>
        ))}
    </RailContext.Provider>
  );
}

/** Стилі панелі: абсолютні фіксовані слоти, щоб заміна кнопок не зсувала колонку. */
const styles = StyleSheet.create({
  button: { position: 'absolute', width: BUTTON_SIZE, height: BUTTON_SIZE }, // слот кнопки
  press: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: BUTTON_SIZE / 2 }, // зона натискання
});
```

Usage on a screen:
```tsx
// у екрані: кнопки, що зʼявляються на панелі, поки екран у фокусі
const controls = useMemo<RailControl[]>(() => [
  { id: 'back', slot: 'top', icon: <BackIcon />, label: 'Назад', onPress: () => router.back() }, // кнопка «назад»
  { id: 'save', slot: 'bottom', icon: <SaveIcon />, label: 'Зберегти', onPress: onSave }, // кнопка «зберегти»
], [onSave]);
useRailControls(controls);
```
Notes: the id `back` on two screens means the button stays and does not animate; give a screen's own button a unique id to make it swap. Memoise `controls` (a new array every render re-registers on every render). Content needs the rail inset: wrap it in `SafeAreaView edges={['left','right']}` (R5).
