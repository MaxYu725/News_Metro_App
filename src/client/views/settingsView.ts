import type { AppState, DataMode, Density } from '../types.js';
import { element } from '../lib/dom.js';

interface SettingsViewOptions {
  state: AppState;
  onFontScale: (value: number) => void;
  onReducedMotion: (value: boolean) => void;
  onDensity: (value: Density) => void;
  onDataMode: (value: DataMode) => void;
}

function switchRow(label: string, description: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = element('input', { className: 'switch__input', attrs: { type: 'checkbox' } });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return element('label', { className: 'setting-row setting-row--switch' }, [
    element('div', {}, [element('span', { className: 'setting-row__label', text: label }), element('span', { className: 'setting-row__description', text: description })]),
    element('span', { className: 'switch' }, [input, element('span', { className: 'switch__track' })]),
  ]);
}

export function settingsView(options: SettingsViewOptions): HTMLElement {
  const view = element('div', { className: 'view settings-view' }, [
    element('section', { className: 'view-heading' }, [
      element('div', {}, [element('p', { className: 'kicker', text: 'SETTINGS' }), element('h1', { text: '設定' })]),
    ]),
  ]);

  const fontValue = element('strong', { className: 'font-scale-value', text: `${Math.round(options.state.fontScale * 100)}%` });
  const minus = element('button', { className: 'stepper-button', text: 'A−', attrs: { type: 'button', 'aria-label': '縮小文字' } });
  const plus = element('button', { className: 'stepper-button', text: 'A＋', attrs: { type: 'button', 'aria-label': '放大文字' } });
  minus.addEventListener('click', () => options.onFontScale(options.state.fontScale - 0.05));
  plus.addEventListener('click', () => options.onFontScale(options.state.fontScale + 0.05));

  view.append(element('section', { className: 'settings-section' }, [
    element('h2', { text: '閱讀' }),
    element('div', { className: 'setting-row' }, [
      element('div', {}, [element('span', { className: 'setting-row__label', text: '文字大小' }), element('span', { className: 'setting-row__description', text: '只調整 App 內文字，不禁止瀏覽器縮放。' })]),
      element('div', { className: 'font-stepper' }, [minus, fontValue, plus]),
    ]),
    switchRow('減少動畫', '停用非必要的轉場及骨架閃動。', options.state.reducedMotion, options.onReducedMotion),
  ]));

  const densityControl = element('div', { className: 'segmented-control', attrs: { role: 'group', 'aria-label': '列表密度' } });
  const densities: Array<{ id: Density; label: string }> = [
    { id: 'comfortable', label: '舒適' },
    { id: 'compact', label: '緊湊' },
  ];
  for (const density of densities) {
    const button = element('button', {
      className: density.id === options.state.density ? 'is-active' : '',
      text: density.label,
      attrs: { type: 'button', 'aria-pressed': String(density.id === options.state.density) },
    });
    button.addEventListener('click', () => options.onDensity(density.id));
    densityControl.append(button);
  }
  view.append(element('section', { className: 'settings-section' }, [
    element('h2', { text: '版面' }),
    element('div', { className: 'setting-row' }, [
      element('div', {}, [element('span', { className: 'setting-row__label', text: '列表密度' }), element('span', { className: 'setting-row__description', text: '切換新聞卡片的留白與摘要顯示。' })]),
      densityControl,
    ]),
  ]));

  const modes: Array<{ id: DataMode; label: string }> = [
    { id: 'ready', label: '正常' },
    { id: 'loading', label: '載入' },
    { id: 'empty', label: '空白' },
    { id: 'error', label: '錯誤' },
    { id: 'offline', label: '離線' },
  ];
  const modeControl = element('div', { className: 'state-preview-grid', attrs: { role: 'group', 'aria-label': '資料狀態預覽' } });
  for (const mode of modes) {
    const button = element('button', {
      className: `state-preview-button${mode.id === options.state.dataMode ? ' is-active' : ''}`,
      text: mode.label,
      attrs: { type: 'button', 'aria-pressed': String(mode.id === options.state.dataMode) },
    });
    button.addEventListener('click', () => options.onDataMode(mode.id));
    modeControl.append(button);
  }
  view.append(element('section', { className: 'settings-section' }, [
    element('h2', { text: 'Phase 1 測試工具' }),
    element('p', { className: 'settings-section__description', text: '切換後返回「最新」，即可檢查 Loading、Empty、Error 及 Offline 畫面。' }),
    modeControl,
  ]));

  view.append(element('section', { className: 'about-card' }, [
    element('span', { className: 'about-card__version', text: '0.1.0 · Phase 1' }),
    element('h2', { text: '未連接任何 API' }),
    element('p', { text: '此版本只包含設計系統、假資料、路由及互動骨架。圖片搜尋、AI、新聞同步與 D1 均未加入。' }),
  ]));
  return view;
}
