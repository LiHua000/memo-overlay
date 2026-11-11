'use strict';

/* 速记 · 渲染层：单页 Markdown 编辑、缓存、设置与贴边状态 */
(() => {
  const $ = (id) => document.getElementById(id);

  const editor = $('editor');
  const preview = $('preview');
  const toolbar = $('toolbar');
  const opacityInput = $('set-opacity');
  const opacityValue = $('opacity-value');
  const saveDot = $('save-dot');
  const saveText = $('save-text');
  const charCount = $('char-count');
  const modeEdit = $('mode-edit');
  const modePreview = $('mode-preview');
  const btnPin = $('btn-pin');
  const btnSettings = $('btn-settings');
  const btnEdge = $('btn-edge');
  const btnClear = $('btn-clear');
  const btnHide = $('btn-hide');
  const btnSettingsClose = $('btn-settings-close');
  const settingsPanel = $('settings');
  const hotkeyBtn = $('hotkey-btn');
  const setOnTop = $('set-ontop');
  const setEdge = $('set-edge');
  const fontSeg = $('font-seg');
  const cachePathEl = $('cache-path');
  const btnOpenCache = $('btn-open-cache');
  const brandHint = $('brand-hint');
  const resizeHandle = $('resize-handle');
  const toastEl = $('toast');
  const toastText = $('toast-text');
  const toastAction = $('toast-action');

  const state = {
    settings: null,
    mode: 'edit',
    dirty: false,
    cleared: false,
    saveTimer: null,
    previewTimer: null,
    lastSavedAt: 0,
    settingsOpen: false,
    recording: false,
    peek: false,
    peekInside: false,
    peekTimer: null,
    editCaret: [0, 0],
    editScroll: 0,
  };

  let toastTimer = null;

  /* ---------------------------------------------------------------- */
  /* 工具                                                             */
  /* ---------------------------------------------------------------- */

  function formatSavedAgo(ms) {
    const diff = Math.max(0, Date.now() - ms);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  }

  function formatAccel(accel) {
    return String(accel || '')
      .replace(/Control/g, 'Ctrl')
      .split('+')
      .join(' + ');
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function showToast(text, options = {}) {
    toastText.textContent = text;
    if (options.actionLabel && typeof options.onAction === 'function') {
      toastAction.hidden = false;
      toastAction.textContent = options.actionLabel;
      toastAction.onclick = () => {
        hideToast();
        options.onAction();
      };
    } else {
      toastAction.hidden = true;
      toastAction.onclick = null;
    }
    toastEl.hidden = false;
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, options.duration || 2400);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
  }

  /* ---------------------------------------------------------------- */
  /* 贴边探出：鼠标离开后缩回                                          */
  /* ---------------------------------------------------------------- */

  function clearPeekTimer() {
    clearTimeout(state.peekTimer);
    state.peekTimer = null;
  }

  function schedulePeekCollapse(delay = 800) {
    if (!state.peek || !state.peekInside) return;
    clearTimeout(state.peekTimer);
    state.peekTimer = setTimeout(() => {
      state.peekTimer = null;
      if (!state.peek) return;
      window.memo.collapseBack();
    }, delay);
  }

  function postponePeekCollapse() {
    if (!state.peekTimer) return;
    schedulePeekCollapse(900);
  }

  /* ---------------------------------------------------------------- */
  /* 状态栏 / 字数                                                    */
  /* ---------------------------------------------------------------- */

  function updateCounts() {
    const text = editor.value;
    const chars = text.replace(/\s/g, '').length;
    charCount.textContent = `${chars} 字`;
    charCount.title = `${text ? text.split('\n').length : 0} 行 · ${chars} 字`;
  }

  function refreshStatus() {
    if (state.dirty) {
      saveDot.className = 'dot dirty';
      saveText.textContent = '编辑中…';
      return;
    }
    if (state.cleared) {
      saveDot.className = 'dot';
      saveText.textContent = '已清空 · 缓存已删除';
      return;
    }
    if (!state.lastSavedAt) {
      saveDot.className = 'dot';
      saveText.textContent = editor.value ? '尚未缓存' : '就绪';
      return;
    }
    saveDot.className = 'dot saved';
    saveText.textContent = `已缓存 · ${formatSavedAgo(state.lastSavedAt)}`;
  }

  /* ---------------------------------------------------------------- */
  /* 缓存                                                             */
  /* ---------------------------------------------------------------- */

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 400);
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (!state.dirty) return;
    const text = editor.value;
    try {
      const savedAt = await window.memo.saveCache(text);
      if (!savedAt) throw new Error('cache write failed');
      if (editor.value === text) {
        state.lastSavedAt = savedAt;
        state.dirty = false;
        state.cleared = false;
        refreshStatus();
      }
    } catch (err) {
      console.error('[memo] save failed', err);
      saveDot.className = 'dot error';
      saveText.textContent = '缓存失败';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Markdown 预览                                                    */
  /* ---------------------------------------------------------------- */

  function renderPreview() {
    const raw = editor.value;
    if (!raw.trim()) {
      preview.innerHTML = '<div class="preview-empty">这里会显示 Markdown 预览<br><span>按 Ctrl + E 回到编辑</span></div>';
      return;
    }

    let html = '';
    try {
      html = window.marked ? window.marked.parse(raw, { gfm: true, breaks: true }) : `<pre>${escapeHtml(raw)}</pre>`;
    } catch (err) {
      console.error('[memo] markdown failed', err);
      html = `<pre>${escapeHtml(raw)}</pre>`;
    }

    try {
      html = window.DOMPurify
        ? window.DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'link', 'meta'],
          FORBID_ATTR: ['style'],
        })
        : escapeHtml(raw);
    } catch (err) {
      console.error('[memo] sanitize failed', err);
      html = `<pre>${escapeHtml(raw)}</pre>`;
    }

    preview.innerHTML = html;
    preview.querySelectorAll('a').forEach((anchor) => {
      anchor.setAttribute('rel', 'noreferrer noopener');
    });
  }

  function setMode(mode) {
    if (mode !== 'edit' && mode !== 'preview') return;
    if (state.mode === mode) return;

    if (mode === 'preview') {
      state.editCaret = [editor.selectionStart, editor.selectionEnd];
      state.editScroll = editor.scrollTop;
      renderPreview();
      editor.hidden = true;
      preview.hidden = false;
      const ratio = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
      preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight);
    } else {
      const ratio = preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight);
      preview.hidden = true;
      editor.hidden = false;
      editor.focus();
      editor.scrollTop = ratio > 0
        ? ratio * Math.max(0, editor.scrollHeight - editor.clientHeight)
        : state.editScroll;
      try {
        editor.setSelectionRange(state.editCaret[0], state.editCaret[1]);
      } catch {
        /* ignore */
      }
    }

    state.mode = mode;
    modeEdit.classList.toggle('active', mode === 'edit');
    modePreview.classList.toggle('active', mode === 'preview');
  }

  /* ---------------------------------------------------------------- */
  /* 编辑辅助                                                         */
  /* ---------------------------------------------------------------- */

  function placeCaretAtEnd() {
    try {
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
    } catch {
      /* ignore */
    }
  }

  function insertAtCursor(text) {
    if (!text) return;
    if (!document.execCommand('insertText', false, text)) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText(text, start, end, 'end');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function commitListLine(lineStart, caret, indent, content, marker) {    if (!content.trim()) {
      editor.setSelectionRange(lineStart, caret);
      if (indent) {
        insertAtCursor(indent);
      } else {
        // 空列表项回车退出列表。这里不能用 insertText('')：
        // Chromium 会把光标重置到文档开头，后续输入会跑到最前面。
        document.execCommand('delete');
      }
      return;
    }
    insertAtCursor(`\n${indent}${marker}`);
  }

  function continueList(event) {
    if (editor.selectionStart !== editor.selectionEnd) return false;

    const caret = editor.selectionStart;
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const line = value.slice(lineStart, caret);

    const task = line.match(/^(\s*)- \[[ xX]\] (.*)$/);
    if (task) {
      event.preventDefault();
      commitListLine(lineStart, caret, task[1], task[2], '- [ ] ');
      return true;
    }

    const bullet = line.match(/^(\s*)([-*+]) (.*)$/);
    if (bullet) {
      event.preventDefault();
      commitListLine(lineStart, caret, bullet[1], bullet[3], `${bullet[2]} `);
      return true;
    }

    const ordered = line.match(/^(\s*)(\d+)\. (.*)$/);
    if (ordered) {
      event.preventDefault();
      commitListLine(lineStart, caret, ordered[1], ordered[3], `${Number(ordered[2]) + 1}. `);
      return true;
    }

    const quote = line.match(/^(\s*)> (.*)$/);
    if (quote) {
      event.preventDefault();
      commitListLine(lineStart, caret, quote[1], quote[2], '> ');
      return true;
    }

    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Markdown 工具栏                                                   */
  /* ---------------------------------------------------------------- */

  function getLineBlock() {
    const value = editor.value;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    let blockEnd = value.indexOf('\n', end);
    if (blockEnd === -1) blockEnd = value.length;
    return { blockStart, blockEnd, value };
  }

  function splitListPrefix(line) {
    const indent = (line.match(/^\s*/) || [''])[0];
    const rest = line.slice(indent.length);

    const task = rest.match(/^- \[[ xX]\] (.*)$/);
    if (task) return { kind: 'todo', indent, body: task[1] };

    const bullet = rest.match(/^[-*+] (.*)$/);
    if (bullet) return { kind: 'ul', indent, body: bullet[1] };

    const ordered = rest.match(/^\d+\. (.*)$/);
    if (ordered) return { kind: 'ol', indent, body: ordered[1] };

    return { kind: null, indent, body: rest };
  }

  function makeListLine(kind, indent, index, body) {
    if (kind === 'todo') return `${indent}- [ ] ${body}`;
    if (kind === 'ul') return `${indent}- ${body}`;
    return `${indent}${index}. ${body}`;
  }

  function toggleList(kind) {
    const { blockStart, blockEnd, value } = getLineBlock();
    const lines = value.slice(blockStart, blockEnd).split('\n');
    const nonEmpty = lines.filter((line) => line.trim());
    const allHave = nonEmpty.length > 0 && nonEmpty.every((line) => splitListPrefix(line).kind === kind);

    let counter = 0;
    const output = lines.map((line) => {
      const info = splitListPrefix(line);
      if (!line.trim()) {
        // 单行空内容：直接补一个前缀，方便马上输入
        return lines.length === 1 ? makeListLine(kind, info.indent, 1, '') : line;
      }
      if (allHave) return `${info.indent}${info.body}`;
      counter += 1;
      const body = info.kind ? info.body : line.slice(info.indent.length);
      return makeListLine(kind, info.indent, counter, body);
    }).join('\n');

    editor.setSelectionRange(blockStart, blockEnd);
    insertAtCursor(output);
    const caret = blockStart + output.length;
    editor.setSelectionRange(caret, caret);
  }

  function toggleInline(marker) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    if (start === end) {
      insertAtCursor(marker + marker);
      const position = Math.max(0, editor.selectionStart - marker.length);
      editor.setSelectionRange(position, position);
      return;
    }

    const selected = editor.value.slice(start, end);
    if (
      selected.length >= marker.length * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      const inner = selected.slice(marker.length, selected.length - marker.length);
      editor.setSelectionRange(start, end);
      insertAtCursor(inner);
      editor.setSelectionRange(start, start + inner.length);
      return;
    }

    editor.setSelectionRange(start, end);
    insertAtCursor(marker + selected + marker);
    editor.setSelectionRange(start + marker.length, end + marker.length);
  }

  function applyMarkdownAction(action) {
    if (state.mode === 'preview') setMode('edit');

    if (action === 'todo' || action === 'ul' || action === 'ol') {
      toggleList(action);
    } else if (action === 'bold') {
      toggleInline('**');
    } else if (action === 'italic') {
      toggleInline('*');
    } else if (action === 'strike') {
      toggleInline('~~');
    } else if (action === 'code') {
      toggleInline('`');
    }

    editor.focus();
  }

  /* ---------------------------------------------------------------- */
  /* 设置                                                             */
  /* ---------------------------------------------------------------- */

  function applyOpacity(alpha) {
    const value = Math.min(1, Math.max(0.55, alpha));
    document.documentElement.style.setProperty('--surface-alpha', value.toFixed(2));
    document.documentElement.style.setProperty('--sheet-alpha', Math.min(1, value + 0.05).toFixed(2));
    const transparency = Math.round((1 - value) * 100);
    opacityInput.value = String(transparency);
    opacityValue.textContent = `${transparency}%`;
  }

  function applySettings(next) {
    if (!next) return;
    state.settings = { ...(state.settings || {}), ...next };
    const settings = state.settings;
    const fontSize = Number(settings.fontSize) || 15;
    const opacity = Number.isFinite(Number(settings.opacity))
      ? Number(settings.opacity)
      : 0.94;

    document.documentElement.style.setProperty('--editor-font', `${fontSize}px`);
    applyOpacity(opacity);
    setOnTop.checked = Boolean(settings.alwaysOnTop);
    setEdge.checked = Boolean(settings.edgeHide);
    btnPin.classList.toggle('active', Boolean(settings.alwaysOnTop));
    btnPin.title = settings.alwaysOnTop ? '取消置顶' : '始终置顶';
    btnPin.setAttribute('aria-label', btnPin.title);
    if (!state.recording) hotkeyBtn.textContent = formatAccel(settings.hotkey) || '未设置';
    brandHint.textContent = formatAccel(settings.hotkey) || '';
    cachePathEl.textContent = settings.cachePath || '';

    document.querySelectorAll('#font-seg button').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.size) === fontSize);
    });
  }

  function openSettings() {
    if (state.settingsOpen) return;
    state.settingsOpen = true;
    settingsPanel.hidden = false;
  }

  function closeSettings() {
    if (!state.settingsOpen) return;
    state.settingsOpen = false;
    cancelHotkeyRecording();
    settingsPanel.hidden = true;
    editor.focus();
  }

  async function patchSetting(patch) {
    try {
      const result = await window.memo.patchSettings(patch);
      if (result && result.ok) {
        applySettings(result.settings);
        return true;
      }
      if (result && result.settings) applySettings(result.settings);
      showToast((result && result.error) || '设置失败', { duration: 4000 });
      return false;
    } catch (err) {
      console.error('[memo] patch failed', err);
      showToast('设置失败', { duration: 4000 });
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 快捷键录制                                                       */
  /* ---------------------------------------------------------------- */

  const SPECIAL_KEYS = {
    Space: 'Space',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
  };

  function acceleratorKey(event) {
    const code = event.code || '';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (SPECIAL_KEYS[code]) return SPECIAL_KEYS[code];
    if (/^[a-zA-Z]$/.test(event.key || '')) return event.key.toUpperCase();
    return '';
  }

  function toAccelerator(event) {
    const mods = [];
    if (event.ctrlKey) mods.push('Control');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (event.metaKey) mods.push('Super');
    if (!mods.length) return '';
    const key = acceleratorKey(event);
    if (!key) return '';
    return [...mods, key].join('+');
  }

  function startHotkeyRecording() {
    if (state.recording) return;
    state.recording = true;
    hotkeyBtn.classList.add('recording');
    hotkeyBtn.textContent = '请按下组合键…';
  }

  function cancelHotkeyRecording() {
    state.recording = false;
    hotkeyBtn.classList.remove('recording');
    hotkeyBtn.textContent = formatAccel(state.settings && state.settings.hotkey) || '未设置';
  }

  async function saveHotkey(accel) {
    state.recording = false;
    hotkeyBtn.classList.remove('recording');
    hotkeyBtn.textContent = '保存中…';
    try {
      const result = await window.memo.patchSettings({ hotkey: accel });
      if (result && result.ok) {
        applySettings(result.settings);
        showToast(`快捷键已更新：${formatAccel(accel)}`, { duration: 3000 });
      } else {
        if (result && result.settings) applySettings(result.settings);
        else cancelHotkeyRecording();
        showToast((result && result.error) || '快捷键不可用', { duration: 4000 });
      }
    } catch (err) {
      console.error('[memo] hotkey failed', err);
      cancelHotkeyRecording();
      showToast('快捷键设置失败', { duration: 4000 });
    }
  }

  function onRecordKey(event) {
    if (!state.recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      cancelHotkeyRecording();
      return;
    }
    if (event.repeat) return;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

    const accel = toAccelerator(event);
    if (!accel) {
      hotkeyBtn.textContent = '需要 Ctrl / Alt / Super + 按键';
      return;
    }
    saveHotkey(accel);
  }

  /* ---------------------------------------------------------------- */
  /* 清空                                                             */
  /* ---------------------------------------------------------------- */

  async function doClear() {
    if (!editor.value.trim() && !state.dirty) {
      showToast('已经是空的了');
      return;
    }

    const previous = editor.value;
    clearTimeout(state.saveTimer);
    editor.value = '';
    state.dirty = false;
    state.cleared = true;
    state.lastSavedAt = 0;
    updateCounts();
    refreshStatus();
    if (state.mode === 'preview') renderPreview();
    editor.focus();

    try {
      await window.memo.clearCache();
    } catch (err) {
      console.error('[memo] clear failed', err);
    }

    showToast('已清空 · 缓存已删除', {
      duration: 6000,
      actionLabel: '撤销',
      onAction: () => {
        editor.value = previous;
        state.cleared = false;
        state.dirty = true;
        state.lastSavedAt = 0;
        updateCounts();
        refreshStatus();
        if (state.mode === 'preview') renderPreview();
        scheduleSave();
        editor.focus();
        placeCaretAtEnd();
        showToast('已恢复');
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* 窗口交互                                                         */
  /* ---------------------------------------------------------------- */

  function bindWindowDrag(handle) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (event.target.closest('button, input, a, .switch, .font-seg, .text-btn, .hotkey-btn')) return;
      if (document.body.classList.contains('edge-collapsed')) return;

      event.preventDefault();
      // 主动拖窗口时取消“离开自动缩回”
      state.peek = false;
      state.peekInside = false;
      clearPeekTimer();
      const start = { x: event.screenX, y: event.screenY };
      let last = { x: start.x, y: start.y };
      let started = false;

      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }

      // 超过 3px 才算拖拽，避免点一下标题栏就进入拖拽状态
      const maybeStart = (point) => {
        if (started) return;
        if (Math.hypot(point.x - start.x, point.y - start.y) < 3) return;
        started = true;
        document.body.classList.add('dragging');
        window.memo.dragStart(start.x, start.y);
      };

      const onMove = (moveEvent) => {
        last = { x: moveEvent.screenX, y: moveEvent.screenY };
        maybeStart(last);
        if (started) window.memo.dragMove(last.x, last.y);
      };

      const cleanup = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        window.removeEventListener('blur', onBlur);
        document.body.classList.remove('dragging');
      };

      const finish = (upEvent) => {
        cleanup();
        if (!started) return;
        const point = upEvent.type === 'pointercancel'
          ? last
          : { x: upEvent.screenX, y: upEvent.screenY };
        window.memo.dragEnd(point.x, point.y);
      };

      const onBlur = () => {
        cleanup();
        if (started) window.memo.dragEnd(last.x, last.y);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      window.addEventListener('blur', onBlur);
    });
  }

  function bindEvents() {
    bindWindowDrag($('titlebar'));
    bindWindowDrag(settingsPanel.querySelector('.settings-head'));

    // 贴边收起/展开后，Linux 下 webContents 可能丢失键盘焦点，点击时兜底找回
    document.addEventListener('pointerdown', () => window.memo.activate(), true);
    editor.addEventListener('input', () => {
      state.dirty = true;
      state.cleared = false;
      postponePeekCollapse();
      updateCounts();
      refreshStatus();
      scheduleSave();
      if (state.mode === 'preview') {
        clearTimeout(state.previewTimer);
        state.previewTimer = setTimeout(renderPreview, 120);
      }
    });

    editor.addEventListener('keydown', (event) => {
      if (event.isComposing) return;

      if (event.key === 'Tab') {
        event.preventDefault();
        insertAtCursor('  ');
        return;
      }

      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        continueList(event);
      }
    });

    editor.addEventListener('blur', () => flushSave());
    window.addEventListener('blur', () => flushSave());

    // 窗口获得焦点后，如果焦点还停在 body 上，把光标送回编辑器，
    // 这样贴边展开/快捷键唤出后可以直接输入。
    window.addEventListener('focus', () => {
      if (state.settingsOpen || state.recording) return;
      if (!document.activeElement || document.activeElement === document.body) {
        if (state.mode === 'preview') setMode('edit');
        editor.focus();
        placeCaretAtEnd();
      }
    });

    window.addEventListener('beforeunload', () => {
      if (state.dirty) {
        try {
          window.memo.saveCacheSync(editor.value);
        } catch {
          /* ignore */
        }
      }
    });

    window.addEventListener('keydown', (event) => {
      if (state.recording || event.defaultPrevented) return;
      postponePeekCollapse();

      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && !event.shiftKey && (event.key === 'e' || event.key === 'E')) {
        if (state.settingsOpen) return;
        event.preventDefault();
        setMode(state.mode === 'edit' ? 'preview' : 'edit');
        return;
      }

      if (event.key === 'Escape') {
        if (state.settingsOpen) {
          event.preventDefault();
          closeSettings();
          return;
        }
        if (state.mode === 'preview') {
          event.preventDefault();
          setMode('edit');
          return;
        }
        event.preventDefault();
        flushSave();
        window.memo.hide();
      }
    });

    window.addEventListener('keydown', onRecordKey, true);

    modeEdit.addEventListener('click', () => setMode('edit'));
    modePreview.addEventListener('click', () => setMode('preview'));

    toolbar.addEventListener('mousedown', (event) => {
      if (event.target.closest('button[data-action]')) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      applyMarkdownAction(button.dataset.action);
    });

    opacityInput.addEventListener('input', () => {
      const transparency = Number(opacityInput.value);
      applyOpacity(1 - transparency / 100);
    });
    opacityInput.addEventListener('change', async () => {
      const transparency = Number(opacityInput.value);
      const ok = await patchSetting({ opacity: 1 - transparency / 100 });
      if (!ok) applyOpacity(Number(state.settings && state.settings.opacity) || 0.94);
    });

    btnPin.addEventListener('click', async () => {
      const next = !(state.settings && state.settings.alwaysOnTop);
      const ok = await patchSetting({ alwaysOnTop: next });
      if (ok) showToast(next ? '已置顶' : '已取消置顶');
    });

    btnSettings.addEventListener('click', openSettings);
    btnSettingsClose.addEventListener('click', closeSettings);
    btnEdge.addEventListener('click', () => {
      flushSave();
      window.memo.collapse();
    });
    btnHide.addEventListener('click', () => {
      flushSave();
      window.memo.hide();
    });
    btnClear.addEventListener('click', () => doClear());

    setOnTop.addEventListener('change', async () => {
      const ok = await patchSetting({ alwaysOnTop: setOnTop.checked });
      if (!ok) setOnTop.checked = !setOnTop.checked;
    });
    setEdge.addEventListener('change', async () => {
      const ok = await patchSetting({ edgeHide: setEdge.checked });
      if (!ok) setEdge.checked = !setEdge.checked;
    });

    fontSeg.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-size]');
      if (!button) return;
      await patchSetting({ fontSize: Number(button.dataset.size) });
    });

    hotkeyBtn.addEventListener('click', startHotkeyRecording);
    btnOpenCache.addEventListener('click', () => window.memo.openCacheDir());

    preview.addEventListener('click', (event) => {
      const anchor = event.target.closest('a');
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) window.memo.openExternal(href);
      else if (href.startsWith('#')) {
        const target = preview.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showToast('仅支持打开 http(s) 链接');
      }
    });

    // 右下角拖动调整窗口大小
    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      state.peek = false;
      state.peekInside = false;
      clearPeekTimer();
      resizeHandle.setPointerCapture(event.pointerId);
      let lastX = event.screenX;
      let lastY = event.screenY;

      const onMove = (moveEvent) => {
        const dx = moveEvent.screenX - lastX;
        const dy = moveEvent.screenY - lastY;
        if (!dx && !dy) return;
        lastX = moveEvent.screenX;
        lastY = moveEvent.screenY;
        window.memo.resizeBy(dx, dy);
      };

      const onUp = () => {
        resizeHandle.removeEventListener('pointermove', onMove);
        resizeHandle.removeEventListener('pointerup', onUp);
        resizeHandle.removeEventListener('pointercancel', onUp);
        flushSave();
      };

      resizeHandle.addEventListener('pointermove', onMove);
      resizeHandle.addEventListener('pointerup', onUp);
      resizeHandle.addEventListener('pointercancel', onUp);
    });

    // 贴边收起后，鼠标移入细条立即展开（主进程还有 120ms 轮询兜底）
    window.addEventListener('mouseenter', () => {
      if (document.body.classList.contains('edge-collapsed')) window.memo.expand();
    });

    // 从贴边探出后：鼠标离开窗口就缩回；期间继续输入则延后
    document.documentElement.addEventListener('pointermove', () => {
      if (!state.peek) return;
      state.peekInside = true;
      clearPeekTimer();
    });
    document.documentElement.addEventListener('pointerenter', () => {
      if (!state.peek) return;
      state.peekInside = true;
      clearPeekTimer();
    });
    document.documentElement.addEventListener('pointerleave', () => {
      if (!state.peek || !state.peekInside) return;
      schedulePeekCollapse();
    });

    window.memo.onEdgeState((edgeState) => {
      const collapsed = Boolean(edgeState && edgeState.collapsed);
      document.body.classList.toggle('edge-collapsed', collapsed);
      if (collapsed) {
        state.peek = false;
        state.peekInside = false;
        clearPeekTimer();
        document.body.dataset.edge = (edgeState && edgeState.side) || '';
        if (state.settingsOpen) {
          state.settingsOpen = false;
          settingsPanel.hidden = true;
        }
        if (state.recording) cancelHotkeyRecording();
        flushSave();
      } else {
        delete document.body.dataset.edge;
        state.peek = Boolean(edgeState && edgeState.peek);
        state.peekInside = state.peek && Boolean(edgeState && (edgeState.hover || edgeState.cursorInside));
        clearPeekTimer();
      }
    });

    window.memo.onFocusEditor(() => {
      if (state.settingsOpen) closeSettings();
      if (state.mode === 'preview') setMode('edit');
      editor.focus();
      placeCaretAtEnd();
      // 贴边展开时窗口焦点可能晚一步才就绪，再补一次
      setTimeout(() => {
        if (!state.settingsOpen && state.mode === 'edit') {
          editor.focus();
          placeCaretAtEnd();
        }
      }, 120);
    });

    window.memo.onClear(() => doClear());
    window.memo.onSettings((next) => applySettings(next));
  }

  /* ---------------------------------------------------------------- */
  /* 启动                                                             */
  /* ---------------------------------------------------------------- */

  async function init() {
    bindEvents();

    let settings = null;
    let cache = { content: '', savedAt: 0 };

    try {
      [settings, cache] = await Promise.all([
        window.memo.getSettings(),
        window.memo.loadCache(),
      ]);
    } catch (err) {
      console.error('[memo] init failed', err);
    }

    applySettings(settings || {
      fontSize: 15,
      alwaysOnTop: true,
      edgeHide: true,
      hotkey: '',
    });

    editor.value = cache.content || '';
    state.lastSavedAt = cache.savedAt || 0;
    state.dirty = false;
    updateCounts();
    refreshStatus();
    setMode('edit');
    modeEdit.classList.add('active');
    modePreview.classList.remove('active');
    document.body.classList.remove('booting');
    editor.focus();
    placeCaretAtEnd();

    if (cache.error) showToast(cache.error, { duration: 5000 });
    if (settings && settings.hotkeyError) {
      showToast(`全局快捷键不可用：${settings.hotkeyError}`, { duration: 6000 });
    }

    // 等一帧后再通知主进程显示窗口，避免首帧闪白
    setTimeout(() => window.memo.ready(), 60);
  }

  init().catch((err) => {
    console.error('[memo] fatal', err);
    document.body.classList.remove('booting');
    try {
      window.memo.ready();
    } catch {
      /* ignore */
    }
  });
})();
