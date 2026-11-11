'use strict';

/*
 * 速记 · 主进程
 *
 * 设计要点：
 * 1. 无边框 + 透明 + 始终置顶的浮层窗口，跨工作区可见；
 * 2. 全局快捷键随时唤出/收起；
 * 3. 拖到屏幕边缘后收成一条细光条，鼠标移上去自动展开（QQ 式贴边隐藏）；
 * 4. 正文只写入应用缓存目录（不生成 .md/.txt 文档），关机能恢复；
 * 5. 单实例、托盘常驻，关闭按钮只隐藏不退出。
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  dialog,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = __dirname;
const APP_ID = 'memo-overlay';

app.setName(APP_ID);
// 固定为 ASCII 路径，避免中文用户名/应用名导致缓存路径异常
app.setPath('userData', path.join(app.getPath('appData'), APP_ID));

const USER_DATA = app.getPath('userData');
const CACHE_DIR = path.join(USER_DATA, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'memo.cache');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');

const MIN_W = 340;
const MIN_H = 280;
const EDGE_TRIGGER = 10; // 距离屏幕边缘多少像素内触发贴边
const STRIP = 7; // 贴边后留下的细条宽度
const DEFAULT_HOTKEY = 'Control+Alt+M';

const DEFAULT_SETTINGS = {
  hotkey: DEFAULT_HOTKEY,
  alwaysOnTop: true,
  edgeHide: true,
  fontSize: 15,
  opacity: 0.94,
  bounds: null,
};

let settings = { ...DEFAULT_SETTINGS };
let win = null;
let tray = null;
let quitting = false;
let hotkeyAccel = '';
let hotkeyRegistered = false;
let hotkeyError = '';
let moveTimer = null;
let saveSettingsTimer = null;

let readyToShow = false;
let rendererReady = false;
let initialShown = false;

const engine = {
  collapsed: false,
  side: null,
  strip: null,
  restoreBounds: null,
  pollTimer: null,
  suppressUntil: 0,
  hoverArmed: false,
};

// 自绘拖拽状态：绕开窗口管理器的“拖到边缘分屏/贴边”行为
const drag = { active: false, offsetX: 0, offsetY: 0 };
let dragWatchdog = null;

function armDragWatchdog() {
  clearTimeout(dragWatchdog);
  dragWatchdog = setTimeout(() => {
    if (!drag.active) return;
    drag.active = false;
    if (win && !win.isDestroyed()) persistBounds();
  }, 2000);
}

function clearDragWatchdog() {
  clearTimeout(dragWatchdog);
  dragWatchdog = null;
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[fs] mkdir failed:', dir, err.message);
  }
}

function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    writeFileAtomic(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] save failed:', err.message);
  }
}

function scheduleSaveSettings() {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(saveSettings, 200);
}

function readCache() {
  try {
    const stat = fs.statSync(CACHE_FILE);
    return { content: fs.readFileSync(CACHE_FILE, 'utf8'), savedAt: stat.mtimeMs, error: '' };
  } catch (err) {
    if (err.code === 'ENOENT') return { content: '', savedAt: 0, error: '' };
    console.error('[cache] read failed:', err.message);
    return { content: '', savedAt: 0, error: '缓存读取失败：' + err.message };
  }
}

function writeCache(text) {
  writeFileAtomic(CACHE_FILE, text);
  return Date.now();
}

function clearCache() {
  try {
    fs.rmSync(CACHE_FILE, { force: true });
  } catch (err) {
    console.error('[cache] clear failed:', err.message);
  }
}

function prettyAccel(accel) {
  return String(accel || '')
    .replace(/Control/g, 'Ctrl')
    .replace(/Super/g, 'Super')
    .split('+')
    .join(' + ');
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function boundsUsable(bounds) {
  if (!bounds || typeof bounds !== 'object') return false;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return false;
  if (width < MIN_W || height < MIN_H) return false;
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    const overlapX = Math.min(x + width, wa.x + wa.width) - Math.max(x, wa.x);
    const overlapY = Math.min(y + height, wa.y + wa.height) - Math.max(y, wa.y);
    return overlapX >= 80 && overlapY >= 80;
  });
}

function initialBounds() {
  if (boundsUsable(settings.bounds)) {
    return { ...settings.bounds, width: Math.max(settings.bounds.width, MIN_W), height: Math.max(settings.bounds.height, MIN_H) };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const height = clamp(600, MIN_H, wa.height - 80);
  return {
    width,
    height,
    x: wa.x + wa.width - width - 28,
    y: wa.y + Math.round((wa.height - height) / 2),
  };
}

function createWindow() {
  const bounds = initialBounds();

  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Linux 下 hasShadow 会让窗管附加不可见阴影框，导致 setBounds/点击坐标偏移
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: '速记',
    icon: path.join(APP_ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* 某些窗口管理器不支持，忽略 */
  }

  Menu.setApplicationMenu(null);

  win.loadFile(path.join(APP_ROOT, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    readyToShow = true;
    tryShowInitial();
    // 渲染层异常时兜底显示，避免应用“隐身”
    setTimeout(() => {
      rendererReady = true;
      tryShowInitial();
    }, 1500);
  });

  win.on('move', () => {
    if (engine.collapsed) {
      if (win && !win.isDestroyed()) engine.strip = win.getBounds();
      return;
    }
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || engine.collapsed) return;
      persistBounds();
      maybeAutoCollapse();
    }, 260);
  });

  win.on('resize', () => {
    if (engine.collapsed) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || engine.collapsed) return;
      persistBounds();
    }, 260);
  });

  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hideWindow();
  });

  win.on('show', () => refreshTray());
  win.on('hide', () => refreshTray());
  win.on('focus', () => focusContents());
  win.on('blur', () => {
    if (drag.active) {
      drag.active = false;
      clearDragWatchdog();
      persistBounds();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });

  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

function tryShowInitial() {
  if (initialShown || !readyToShow || !rendererReady) return;
  if (!win || win.isDestroyed() || engine.collapsed) return;
  initialShown = true;
  if (process.argv.includes('--hidden')) return;
  showWindow();
}

function focusContents() {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.focus();
  } catch {
    /* ignore */
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (engine.collapsed) {
    expandFromEdge(true);
    return;
  }
  if (!win.isVisible()) win.show();
  win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  win.moveTop();
  win.focus();
  focusContents();
  win.webContents.send('app:focus-editor');
  refreshTray();
}

function hideWindow() {
  if (!win || win.isDestroyed()) return;
  persistBounds();
  win.hide();
  refreshTray();
}

function toggleWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (engine.collapsed) {
    expandFromEdge(true);
    return;
  }
  if (win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

function persistBounds() {
  if (!win || win.isDestroyed() || engine.collapsed) return;
  const b = win.getBounds();
  if (!boundsUsable(b)) return;
  const prev = settings.bounds;
  if (prev && prev.x === b.x && prev.y === b.y && prev.width === b.width && prev.height === b.height) return;
  settings.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  scheduleSaveSettings();
}

/* ------------------------------------------------------------------ */
/* 贴边隐藏                                                            */
/* ------------------------------------------------------------------ */

function autoCollapseCandidate(threshold = EDGE_TRIGGER) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const candidates = [
    ['left', Math.abs(b.x - wa.x)],
    ['right', Math.abs(b.x + b.width - (wa.x + wa.width))],
    ['top', Math.abs(b.y - wa.y)],
    ['bottom', Math.abs(b.y + b.height - (wa.y + wa.height))],
  ];
  candidates.sort((a, b2) => a[1] - b2[1]);
  return candidates[0][1] <= threshold ? candidates[0][0] : null;
}

function edgeFromPoint(point, threshold = 14) {
  const wa = screen.getDisplayNearestPoint(point).workArea;
  const candidates = [
    ['left', Math.abs(point.x - wa.x)],
    ['right', Math.abs(point.x - (wa.x + wa.width))],
    ['top', Math.abs(point.y - wa.y)],
    ['bottom', Math.abs(point.y - (wa.y + wa.height))],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] <= threshold ? candidates[0][0] : null;
}

function nearestEdge() {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const candidates = [
    ['left', Math.abs(b.x - wa.x)],
    ['right', Math.abs(b.x + b.width - (wa.x + wa.width))],
    ['top', Math.abs(b.y - wa.y)],
    ['bottom', Math.abs(b.y + b.height - (wa.y + wa.height))],
  ];
  candidates.sort((a, b2) => a[1] - b2[1]);
  return candidates[0][0];
}

function maybeAutoCollapse() {
  if (!settings.edgeHide || drag.active || engine.collapsed || !win || win.isDestroyed() || !win.isVisible()) return;
  if (Date.now() < engine.suppressUntil) return;
  const side = autoCollapseCandidate();
  if (side) collapseToEdge(side);
}

function collapseToEdge(side) {
  if (!win || win.isDestroyed() || engine.collapsed) return;

  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const h = clamp(Math.round(b.height * 0.62), 140, 280);
  const w = clamp(Math.round(b.width * 0.62), 180, 340);

  let strip;
  if (side === 'left' || side === 'right') {
    strip = {
      x: side === 'left' ? wa.x : wa.x + wa.width - STRIP,
      y: clamp(b.y + Math.round((b.height - h) / 2), wa.y, wa.y + wa.height - h),
      width: STRIP,
      height: h,
    };
  } else {
    strip = {
      x: clamp(b.x + Math.round((b.width - w) / 2), wa.x, wa.x + wa.width - w),
      y: side === 'top' ? wa.y : wa.y + wa.height - STRIP,
      width: w,
      height: STRIP,
    };
  }

  engine.collapsed = true;
  engine.side = side;
  engine.strip = strip;
  engine.restoreBounds = { ...b };
  engine.suppressUntil = Date.now() + 700;
  engine.hoverArmed = false;

  // 必须先放开最小尺寸，否则 setBounds 会被窗口管理器钳制；
  // 先设 bounds 再锁尺寸，避免个别 WM 把 PMaxSize 固定在当前大小
  win.setMinimumSize(1, 1);
  win.setResizable(true);
  win.setSkipTaskbar(true);
  win.setBounds(strip, false);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'screen-saver');

  sendEdgeState();
  startEdgePolling();
  refreshTray();
}

function expandFromEdge(focus = true) {
  if (!win || win.isDestroyed() || !engine.collapsed) return;

  const restore = engine.restoreBounds && boundsUsable(engine.restoreBounds)
    ? engine.restoreBounds
    : initialBounds();
  const wa = screen.getDisplayMatching(restore).workArea;

  engine.collapsed = false;
  engine.side = null;
  engine.strip = null;
  engine.suppressUntil = Date.now() + 900;
  stopEdgePolling();

  win.setResizable(true);
  win.setMinimumSize(MIN_W, MIN_H);
  win.setSkipTaskbar(false);
  win.setBounds(
    {
      x: clamp(restore.x, wa.x, wa.x + wa.width - Math.max(restore.width, MIN_W)),
      y: clamp(restore.y, wa.y, wa.y + wa.height - Math.max(restore.height, MIN_H)),
      width: Math.max(restore.width, MIN_W),
      height: Math.max(restore.height, MIN_H),
    },
    false,
  );
  win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  if (!win.isVisible()) win.show();
  if (focus) {
    win.moveTop();
    win.focus();
    focusContents();
    win.webContents.send('app:focus-editor');
  }

  persistBounds();
  sendEdgeState();
  refreshTray();
}

function sendEdgeState() {
  if (win && !win.isDestroyed()) {
    win.webContents.send('edge:state', { collapsed: engine.collapsed, side: engine.side });
  }
}

function startEdgePolling() {
  stopEdgePolling();
  // 细条只有 7px，用光标轮询保证“碰到就展开”。
  // 收起时光标通常还压在边缘上，必须先移开一次再回来，避免刚收起就弹出。
  engine.pollTimer = setInterval(() => {
    if (!engine.collapsed || !engine.strip || !win || win.isDestroyed()) {
      stopEdgePolling();
      return;
    }
    const p = screen.getCursorScreenPoint();
    const s = engine.strip;
    const inside =
      p.x >= s.x - 3 && p.x <= s.x + s.width + 3 &&
      p.y >= s.y - 3 && p.y <= s.y + s.height + 3;

    if (!inside) {
      engine.hoverArmed = true;
      return;
    }
    if (engine.hoverArmed) expandFromEdge(true);
  }, 120);
}

function stopEdgePolling() {
  if (engine.pollTimer) {
    clearInterval(engine.pollTimer);
    engine.pollTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* 快捷键 / 托盘                                                       */
/* ------------------------------------------------------------------ */

function applyHotkey(accel) {
  if (!accel) return { ok: false, error: '快捷键为空' };
  if (hotkeyRegistered && hotkeyAccel === accel) return { ok: true };
  try {
    const ok = globalShortcut.register(accel, toggleWindow);
    if (!ok) return { ok: false, error: '快捷键注册失败，可能已被其他应用占用' };
  } catch (err) {
    return { ok: false, error: '快捷键无效：' + err.message };
  }
  if (hotkeyRegistered && hotkeyAccel) {
    try {
      globalShortcut.unregister(hotkeyAccel);
    } catch {
      /* ignore */
    }
  }
  hotkeyAccel = accel;
  hotkeyRegistered = true;
  return { ok: true };
}

function buildTrayMenu() {
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  const items = [];

  if (engine.collapsed) {
    items.push({ label: '展开速记', click: () => expandFromEdge(true) });
  } else if (visible) {
    items.push({ label: '隐藏速记', click: () => hideWindow() });
  } else {
    items.push({ label: '唤出速记', click: () => showWindow() });
  }

  items.push(
    { label: '贴边收起', enabled: visible && !engine.collapsed, click: () => collapseToEdge(nearestEdge()) },
    { type: 'separator' },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        if (win && !win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
        saveSettings();
        broadcastSettings();
        refreshTray();
      },
    },
    {
      label: '贴边自动隐藏',
      type: 'checkbox',
      checked: settings.edgeHide,
      click: (item) => {
        settings.edgeHide = item.checked;
        saveSettings();
        broadcastSettings();
        refreshTray();
      },
    },
    { type: 'separator' },
    { label: '清空内容…', click: () => clearFromTray() },
    { type: 'separator' },
    { label: `快捷键：${prettyAccel(settings.hotkey)}`, enabled: false },
    { label: '退出速记', click: () => { quitting = true; app.quit(); } },
  );

  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`速记 · ${prettyAccel(settings.hotkey)}`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const iconPath = path.join(APP_ROOT, 'assets', 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    const fallback = nativeImage.createFromPath(path.join(APP_ROOT, 'assets', 'icon.png'));
    if (!fallback.isEmpty()) image = fallback.resize({ width: 22, height: 22 });
  }
  if (image.isEmpty()) {
    console.warn('[tray] 托盘图标缺失，已跳过托盘');
    return;
  }

  try {
    tray = new Tray(image);
    tray.setToolTip(`速记 · ${prettyAccel(settings.hotkey)}`);
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => toggleWindow());
    tray.on('double-click', () => showWindow());
  } catch (err) {
    console.error('[tray] 创建失败:', err.message);
    tray = null;
  }
}

async function clearFromTray() {
  const options = {
    type: 'warning',
    buttons: ['清空', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: '清空全部内容？',
    detail: '正文与本地缓存会被一并删除，此操作不可撤销。',
  };
  const result = win && !win.isDestroyed() && win.isVisible()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) return;

  clearCache();
  if (win && !win.isDestroyed()) win.webContents.send('app:clear');
}

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(url);
    }
  } catch {
    /* 非法链接忽略 */
  }
}

/* ------------------------------------------------------------------ */
/* 设置广播 / IPC                                                      */
/* ------------------------------------------------------------------ */

function publicSettings() {
  return {
    ...settings,
    cachePath: CACHE_FILE,
    userDataPath: USER_DATA,
    hotkeyError,
  };
}

function broadcastSettings() {
  if (win && !win.isDestroyed()) win.webContents.send('settings:changed', publicSettings());
}

function registerIpc() {
  ipcMain.handle('cache:load', () => ({ ...readCache(), cachePath: CACHE_FILE }));
  ipcMain.handle('cache:save', (_event, text) => {
    if (typeof text !== 'string') return 0;
    try {
      return writeCache(text);
    } catch (err) {
      console.error('[cache] save failed:', err.message);
      return 0;
    }
  });
  ipcMain.on('cache:save-sync', (event, text) => {
    if (typeof text !== 'string') {
      event.returnValue = 0;
      return;
    }
    try {
      event.returnValue = writeCache(text);
    } catch (err) {
      console.error('[cache] sync save failed:', err.message);
      event.returnValue = 0;
    }
  });
  ipcMain.handle('cache:clear', () => {
    clearCache();
    return true;
  });

  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:patch', (_event, patch) => {
    if (!patch || typeof patch !== 'object') return { ok: false, error: '参数错误' };

    if (typeof patch.hotkey === 'string') {
      const result = applyHotkey(patch.hotkey);
      if (!result.ok) return { ok: false, error: result.error, settings: publicSettings() };
      settings.hotkey = patch.hotkey;
      hotkeyError = '';
    }

    if ('alwaysOnTop' in patch) {
      settings.alwaysOnTop = Boolean(patch.alwaysOnTop);
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
      }
    }

    if ('edgeHide' in patch) {
      settings.edgeHide = Boolean(patch.edgeHide);
    }

    if ('fontSize' in patch) {
      const size = Number(patch.fontSize);
      if (Number.isFinite(size)) settings.fontSize = clamp(Math.round(size), 11, 24);
    }

    if ('opacity' in patch) {
      const opacity = Number(patch.opacity);
      if (Number.isFinite(opacity)) settings.opacity = clamp(opacity, 0.55, 1);
    }

    saveSettings();
    broadcastSettings();
    refreshTray();
    return { ok: true, settings: publicSettings() };
  });

  ipcMain.on('window:hide', () => hideWindow());
  ipcMain.on('window:activate', () => {
    if (!win || win.isDestroyed()) return;
    win.focus();
    focusContents();
  });
  ipcMain.on('window:collapse', () => {
    if (!win || win.isDestroyed() || engine.collapsed) return;
    if (!win.isVisible()) return;
    collapseToEdge(nearestEdge());
  });
  ipcMain.on('window:expand', () => {
    if (engine.hoverArmed) expandFromEdge(true);
  });
  ipcMain.on('window:resize-by', (_event, delta) => {
    if (!win || win.isDestroyed() || engine.collapsed || !delta) return;
    const dx = Number(delta.dx) || 0;
    const dy = Number(delta.dy) || 0;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const maxWidth = Math.max(MIN_W, wa.x + wa.width - b.x);
    const maxHeight = Math.max(MIN_H, wa.y + wa.height - b.y);
    win.setBounds({
      x: b.x,
      y: b.y,
      width: clamp(b.width + dx, MIN_W, Math.min(1400, maxWidth)),
      height: clamp(b.height + dy, MIN_H, Math.min(1200, maxHeight)),
    });
  });

  // 自绘拖拽：由渲染层跟随指针，避免窗口管理器把“拖到边缘”识别成分屏
  ipcMain.on('window:drag-start', (_event, point) => {
    if (!win || win.isDestroyed() || engine.collapsed) return;
    const x = Number(point && point.x);
    const y = Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const b = win.getBounds();
    drag.active = true;
    drag.offsetX = x - b.x;
    drag.offsetY = y - b.y;
    clearTimeout(moveTimer);
    armDragWatchdog();
  });

  ipcMain.on('window:drag-move', (_event, point) => {
    if (!drag.active || !win || win.isDestroyed()) return;
    const x = Number(point && point.x);
    const y = Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    armDragWatchdog();

    const b = win.getBounds();
    const cursor = { x: Math.round(x), y: Math.round(y) };
    const wa = screen.getDisplayNearestPoint(cursor).workArea;
    const nextX = clamp(Math.round(x - drag.offsetX), wa.x - b.width + 90, wa.x + wa.width - 90);
    const nextY = clamp(Math.round(y - drag.offsetY), wa.y, wa.y + wa.height - 60);
    win.setPosition(nextX, nextY);
  });

  ipcMain.on('window:drag-end', (_event, point) => {
    if (!drag.active) return;
    drag.active = false;
    clearDragWatchdog();
    if (!win || win.isDestroyed()) return;
    persistBounds();

    if (!settings.edgeHide) return;
    const cursor = {
      x: Number(point && point.x),
      y: Number(point && point.y),
    };
    if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return;

    let side = edgeFromPoint(cursor);
    if (!side) side = autoCollapseCandidate(14);
    if (side) collapseToEdge(side);
  });

  ipcMain.handle('shell:open-external', (_event, url) => openExternal(url));
  ipcMain.handle('shell:open-cache-dir', () => {
    ensureDir(CACHE_DIR);
    return shell.openPath(CACHE_DIR);
  });

  ipcMain.on('app:ready', () => {
    rendererReady = true;
    tryShowInitial();
  });
  ipcMain.on('app:quit', () => {
    quitting = true;
    app.quit();
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

function bootstrap() {
  settings = readSettings();

  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    ensureDir(USER_DATA);

    const result = applyHotkey(settings.hotkey);
    if (!result.ok) {
      hotkeyError = result.error;
      hotkeyRegistered = false;
      console.warn('[hotkey] 注册失败:', result.error);
    }

    registerIpc();
    createWindow();
    createTray();

    try {
      const { session } = require('electron');
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    } catch {
      /* ignore */
    }

    app.on('activate', () => showWindow());

    // 显示器变化后，避免窗口留在屏幕外（screen 模块必须等 ready 之后才能用）
    screen.on('display-metrics-changed', () => {
      if (win && !win.isDestroyed() && !engine.collapsed && win.isVisible()) {
        const b = win.getBounds();
        if (!boundsUsable(b)) win.setBounds(initialBounds(), false);
      }
    });
  });

  app.on('before-quit', () => {
    quitting = true;
    stopEdgePolling();
    persistBounds();
    saveSettings();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // 常驻托盘：窗口全部关闭也不退出
  app.on('window-all-closed', () => {});
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}
