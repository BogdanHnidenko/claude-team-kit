---
name: iphone-duo
description: Standards for designing and building React Native / Expo apps for Apple's foldable iPhone Duo (Xcode 27.1, iOS 27.1, Expo SDK 58). Covers controls moving to the side rail, an animated custom control rail, size classes, asymmetric safe areas, hinge and fold, required native packages (expo-hinge and others) and how to verify. Use when the task, the spec or the project targets iPhone Duo or a foldable iPhone, or when `pl duo` prints "DUO: on".
---

# iPhone Duo standards (designer + mobile developer)

Read this ONLY when the project is Duo-enabled (`node ~/.claude/pipeline/pipeline.mjs duo` prints `DUO: on`) and the task touches mobile UI. Otherwise ignore it: it costs tokens.
Code samples below follow the project's rule: every function, variable and type has a comment in the project's comment language (Ukrainian here). Always obey `pl conventions` first.

## 1. Facts you can rely on (Apple + Expo docs, Nov 2026)
- iPhone Duo is Apple's first foldable iPhone; the simulator ships in **Xcode 27.1** (iOS 27.1 runtime) and runs in **Device Hub**, which replaced Simulator.app. Expo needs **SDK 58** (EAS image `sdk-58` or `latest`).
- Size classes: outer display portrait = compact × regular, outer landscape = compact × compact, inner display = regular × regular. Apple: design around the two width classes only, no fixed widths or breakpoints tied to a screen.
- **Closed (outer display): toolbars, tab bars and controls move to the right side** ("rail") to save vertical space and sit under the right thumb. Top toolbar items go to the top of the side column, bottom items to the bottom; the tab bar stays bottom-aligned. Items too wide for the column (a text button, a segmented control) stay in the nav bar. If there is not enough room the controls collapse into an overflow menu. In Split View an app on the left gets its controls on the left edge. On the inner display in portrait the normal horizontal bars stay.
- The rail is shared with the system status bar and the Dynamic Island. The rail adds roughly an **84 pt** inset on one side.
- Safe areas and margins are often **asymmetric**; do not assume opposite insets are equal.
- Partially folded: keep interactive elements out of the curve; in portrait put them in the bottom half; scrollable content may cross the fold; system sheets, alerts, menus avoid the fold by themselves.
- Apple gives **no animation timings** for the rail; the motion values in §2 R4 are this kit's defaults.
- Apple: `UIRequiresFullScreen` is still honoured but the app still resizes on open/close; on iOS 27 orientation locks are preferences, not guarantees.

## 2. House rules: the standard for ALL Duo work
**R1. Size classes, not guesses.** Branch on width (compact / regular) from `useWindowDimensions()` or a small `useLayoutMode()` hook (compact < 600, medium < 900, expanded ≥ 900 pt is a good default). Never on orientation, device name, idiom or a number computed once at module load (`Dimensions.get('window')` at file top goes stale after a fold).
**R2. One hierarchy for every pose.** Same controls and same information structure on outer and inner display; a pose may rearrange them but never remove functionality or tie a feature to a pose. Do not build a layout per pose.
**R3. All controls live in the rail.** Decision order:
1. **Native first.** Use Expo Router `Stack` headers/toolbars and `NativeTabs`: iOS places the items in the rail, handles overflow and fold avoidance for free. Header items stack in one column; text-only items stay in a bar; **custom views are omitted from the rail**. Use icon items (SF Symbols) for everything that can be an icon.
2. **Custom control rail** (`references/control-rail.md`) only for buttons that cannot be native items or that need the motion in R4. It renders at the rail edge when the system rail is active (`useVerticalBarEdgeIOS()` is not `null`) and falls back to the classic top/bottom placement otherwise.
3. Text buttons and segmented controls stay in the nav bar (Apple's exception). Never put a control into the content area "because it is easier".
4. Rail buttons: 44–48 pt hit area, 8–12 pt gap, SF Symbol / icon + `accessibilityLabel`, `testID="rail-<id>"`; at most 4 per column, more go into one overflow (`…`) menu.
**R4. Rail motion (appear / disappear).**
| Aspect | Standard |
|---|---|
| Direction | A button slides IN from the rail edge toward the screen and slides OUT back to the same edge. It starts fully outside the screen edge. |
| Enter | 220 ms, ease-out (cubic), opacity 0→1 over the first 120 ms |
| Exit | 160 ms, ease-in (cubic), opacity 1→0 |
| Concurrency | The outgoing and the incoming button start in the **same frame**. Never wait for the exit to finish (no "wait" mode, no sequencing). They share one fixed slot and overlap while moving. |
| Slots | Fixed slots (top group anchored top, bottom group anchored bottom) so a swap never reflows the column. The remaining buttons shift with a 200 ms linear layout transition. |
| Same button on both screens | Same key → it stays put and does NOT animate; only changed buttons animate. |
| Reduce Motion | Fade only (120 ms in, 100 ms out), no slide. |
| Interaction | Pressed state ≤ 80 ms (scale .96 / opacity .85). An exiting button ignores touches (`pointerEvents="none"`). |
| Back navigation | On "back" the current screen's buttons exit while the previous screen's buttons enter at once, driven by focus, independent of the screen's own push/pop animation. |
**R5. Safe areas.** `SafeAreaView` from `react-native-safe-area-context` with `edges={['left','right']}` **inside** the `ScrollView` so backgrounds still reach the edge; floating / absolute elements (FAB, toast, sticky bar): `right: insets.right + 16` and `left: insets.left + 16`, never plain `16`; horizontal carousels need their own end padding; read both `insets.left` and `insets.right` (RTL keeps the rail on the camera's physical edge); inside `NativeTabs` do not add a fixed tab-bar height on top of `insets.bottom`.
**R6. Fold.** Keep every interactive element out of the curve (system components do this by themselves). Prefer `ArrangementView` (`@expo/ui/swift-ui`, iOS 27.1+) or Expo Router `<SplitView>` for two-pane screens over hand-made fold layouts. Use `useHinge()` / `useReservedRegions()` only when exact fold or camera geometry is required (a game board split at the crease). Scrollable content may cross the fold.
**R7. State survives fold, unfold and rotation.** Scroll position, form input, open sheets, cart, selected tab. No remount on size change; when a list's column count changes, change its `key` (FlatList cannot change `numColumns` on a mounted list) and restore the first visible index.
**R8. Screens that need the whole display** (full-screen media, single-button sheets): `<StatusBar verticalBarBehaviorIOS="disabled" />` per screen. Open portrait always has the bar disabled.
**R9. Native iOS code** (modules, plugins): never `UIScreen.main`; use `window.windowScene?.screen`, traits (`horizontalSizeClass`, `displayScale`) and scene bounds; concentric corners via `ConcentricRectangle` (SwiftUI) / `UICornerConfiguration` (UIKit).
**R10. Process.** Developers do not run simulators (kit rule); the tester and the user verify (§6). Everything a developer adds for Duo must be listed in NOTES.

## 3. Packages and setup (developer)
Run `node ~/.claude/pipeline/pipeline.mjs duo setup`: it checks Expo SDK ≥ 58 and installs the missing base packages with `npx expo install`:
- `expo-hinge` (hinge angle and status: `useHinge()`, `getHinge()`, `addHingeListener()`; status `closed | partiallyOpen | fullyOpen | unknown`)
- `react-native-safe-area-context` (`SafeAreaView`, `useSafeAreaInsets`)
- `expo-status-bar` (`StatusBar`, `useVerticalBarEdgeIOS()` → `'leading' | 'trailing' | null`)
- `react-native-reanimated` + `react-native-worklets` (R4 motion; `expo-hinge/reanimated` also needs them)
Optional (`duo setup --all`, only when the task needs them): `react-native-reserved-regions` (`useReservedRegions()`: exact fold/camera geometry), `@expo/ui` (`ArrangementView`).
These are **native modules**: after installing, a new native build is required (dev client / `expo run:ios` / EAS). A developer does NOT build or launch (R10): list "needs new native build" in NOTES so the orchestrator tells the user.
Expo Router is the supported way to get the system rail (`Stack`, `NativeTabs` with `preferredPlacement`: `'sidebar' | 'tabBar' | 'automatic'`). JS `<Stack>` headers and `<TabList>` render classically; `<TabList>` in the vertical rail is not supported.

## 4. Designer deliverables (extra sections in `docs/design/<id>.md`)
1. **Poses and classes:** one layout per size class (compact outer, regular inner) with the same hierarchy; no per-pose layouts unless justified.
2. **Rail map:** a table per screen: control → icon (SF Symbol name) → slot (top|bottom) → native or custom → visible on which screens. This is what the developer implements.
3. **Rail motion:** reuse R4 verbatim or state each deviation with a reason.
4. **Fold-safe zones:** what sits in the bottom half in portrait folded, what must stay out of the curve.
5. **Edge cases:** Split View left/right (rail edge flips), RTL, long titles next to the rail, Dynamic Island growing, Reduce Motion, large text.
6. **Visual acceptance (V-n)** examples: "Closed: no interactive element is closer than 84 pt to the rail edge except the rail buttons", "Back from B to A: B's buttons slide out right and A's buttons slide in right at the same time (≤ 220 ms)", "Rail buttons are 44 pt high with 8 pt gaps".
The mockup (`mockup.html`) may show the rail as a 84 px column on the right of a 390 px wide frame; label it "Duo closed".

## 5. Developer checklist (before reporting DONE)
- [ ] `pl duo` says READY (SDK 58, packages present); new native packages listed in NOTES.
- [ ] No orientation / idiom / fixed-width checks; sizes read at render.
- [ ] Controls are native header/toolbar items or `ControlRail`; none left in the content area; text/segmented in nav bar.
- [ ] Rail motion per R4 (concurrent swap, fixed slots, Reduce Motion variant); `testID="rail-<id>"`.
- [ ] Safe areas: both insets read, absolute elements offset, carousels padded, ScrollView/SafeAreaView order.
- [ ] State kept across fold (no remount, list key rule).
- [ ] Comments in the project language on every function/variable.

## 6. Verification (not done by developers)
- Device Hub: Closed / Partially Open / Open buttons, rotate, hinge slider (0–180°); Split View: drag the app from the home indicator to a side.
- `xcrun simctl` has **no** fold or posture command. The open-source CLI `hinge` (github.com/artemnovichkov/hinge, `brew install artemnovichkov/tap/hinge`) sends the hinge event through a private interface (can break with Xcode updates): `hinge orient portrait && hinge close`, `hinge open`, `hinge 110`; wait ~10 s before capturing. Screenshots per display: `xcrun simctl io <UDID> screenshot --display=1` (outer) / `--display=3` (inner); a switched-off display returns a black image without an error.
- The tester can check the closed (outer) display with the normal tools; other poses are `blocked` with the note "manual fold check" unless `hinge` is installed. StandBy and most app extensions do not run in the simulator.
- Checklist for a human: fold, unfold, rotate, partially open and Split View on each screen; nothing important under the rail; no layout jump when opening; nothing needed sits in the fold; state persists mid-session.

## 7. Not verified here (say so, do not pretend)
- The rail-motion numbers (R4) are kit defaults; check the feel on a real device.
- `useFocusEffect` timing of the custom rail (swap exactly at transition start) is reasoned from React Navigation behaviour, not tested on Duo.
- Whether `useVerticalBarEdgeIOS()`'s `leading/trailing` flips with RTL: derive the physical side from the insets (done in the sample).
- Reanimated builder names (`SlideInRight`, `SlideOutRight`, `.easing()`) must be checked against the installed version.

## Sources
- Apple, Design for iPhone Duo: https://developer.apple.com/videos/play/tech-talks/111466/
- Apple, Prepare your app for iPhone Duo: https://developer.apple.com/videos/play/tech-talks/111461/
- Expo, Supporting iPhone Duo: https://expo.dev/blog/supporting-iphone-duo
- Expo, `expo-hinge`: https://docs.expo.dev/versions/latest/sdk/hinge/
- Simulator folding from a script: https://objectgraph.com/blog/fold-the-iphone-duo-simulator-from-a-script/
