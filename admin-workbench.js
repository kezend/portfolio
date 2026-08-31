(function() {
  'use strict';

  const api = window.__portfolioAdmin;
  const projects = window.__projects;
  if (!api || !projects) return;

  const LAYER_KEY = 'portfolio-admin-layers-v1';
  const RESPONSIVE_KEY = 'portfolio-admin-responsive-v1';
  const CASE_KEY = 'portfolio-admin-cases-v1';
  const DRAFT_KEY = 'portfolio-admin-draft-v1';
  const HISTORY_KEY = 'portfolio-admin-history-v1';
  const PUBLISHED_KEY = 'portfolio-admin-published-v1';
  const ADMIN_API = 'http://127.0.0.1:4178/api';
  const MAX_HISTORY = 24;

  let layerMeta = readJSON(LAYER_KEY, {});
  let responsive = readJSON(RESPONSIVE_KEY, { desktop: {}, tablet: {}, mobile: {} });
  let viewMode = 'desktop';
  let desktopStyleCache = new Map();
  let saveTimer = null;
  let dirty = false;
  let galleryDragIndex = null;
  let caseKey = Object.keys(projects)[0] || '';
  let snapEnabled = true;
  let gridEnabled = false;
  let lassoMode = false;
  let copiedObjects = [];
  let publishedSignature = readJSON(PUBLISHED_KEY, '');
  const collapsedGroups = new Set();

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  async function helperRequest(endpoint, payload, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || 2500);
    try {
      const response = await fetch(`${ADMIN_API}${endpoint}`, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Admin helper error');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fileName(src) {
    if (!src) return 'Пустой слот';
    const clean = String(src).split('?')[0];
    try { return decodeURIComponent(clean.split('/').pop()); }
    catch (error) { return clean.split('/').pop(); }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return 'вес неизвестен';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function assetBytes(src) {
    if (!src) return null;
    if (String(src).startsWith('data:')) {
      const encoded = String(src).split(',')[1] || '';
      return Math.round(encoded.length * 0.75);
    }
    const path = decodeURIComponent(String(src).replace(/^\.\//, '').split('?')[0]);
    return window.__PORTFOLIO_ASSET_SIZES__?.[path]?.bytes ?? null;
  }

  const workbench = document.createElement('aside');
  workbench.className = 'admin-workbench';
  workbench.id = 'adminWorkbench';
  workbench.innerHTML = `
    <div class="admin-workbench-header">
      <div class="admin-view-switch" aria-label="Режим адаптива">
        <button type="button" class="active" data-admin-view="desktop">Desktop</button>
        <button type="button" data-admin-view="tablet">Tablet</button>
        <button type="button" data-admin-view="mobile">Mobile</button>
      </div>
      <div class="admin-save-state" id="adminSaveState">Сохранено</div>
      <div class="admin-publish-state" id="adminPublishState">Черновик</div>
      <button type="button" class="admin-icon-btn" id="adminExit" title="Выйти из режима редактирования">x</button>
    </div>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab active" data-admin-tab="layers">Слои</button>
      <button type="button" class="admin-tab" data-admin-tab="align">Группа</button>
      <button type="button" class="admin-tab" data-admin-tab="case">Кейс</button>
      <button type="button" class="admin-tab" data-admin-tab="gallery">Галерея</button>
      <button type="button" class="admin-tab" data-admin-tab="history">История</button>
      <button type="button" class="admin-tab" data-admin-tab="trash">Корзина</button>
    </div>
    <section class="admin-panel active" data-admin-panel="layers">
      <div class="admin-layer-filters">
        <input class="admin-field" id="adminLayerSearch" type="search" placeholder="Поиск слоёв">
        <select class="admin-select" id="adminLayerType" aria-label="Тип слоя">
          <option value="all">Все типы</option>
          <option value="card">Карточки</option>
          <option value="badge">Подписи</option>
          <option value="tag">Теги</option>
        </select>
      </div>
      <button type="button" class="admin-action-btn" id="adminLasso">Рамка выделения</button>
      <button type="button" class="admin-action-btn" id="adminDeleteSelected" style="margin-top:5px">В корзину</button>
      <div class="admin-section-title">Все объекты</div>
      <div class="admin-layer-list" id="adminLayerList"></div>
    </section>
    <section class="admin-panel" data-admin-panel="align">
      <div class="admin-section-title">Точные параметры</div>
      <div class="admin-coordinate-grid">
        <label>X<input type="number" id="adminCoordX" step="1"></label>
        <label>Y<input type="number" id="adminCoordY" step="1"></label>
        <label>Угол<input type="number" id="adminCoordR" step="1"></label>
        <label>W<input type="number" id="adminCoordW" min="1" step="1"></label>
        <label>H<input type="number" id="adminCoordH" min="1" step="1"></label>
        <label>Сетка<input type="number" id="adminGridStep" min="1" value="8" step="1"></label>
      </div>
      <label class="admin-check-row"><input type="checkbox" id="adminGridSnap"> Привязка к сетке</label>
      <div class="admin-section-title">Выравнивание выбранного</div>
      <div class="admin-toolbar-grid">
        <button type="button" class="admin-icon-btn" data-align="left" title="По левому краю">L</button>
        <button type="button" class="admin-icon-btn" data-align="hcenter" title="По центру горизонтально">C</button>
        <button type="button" class="admin-icon-btn" data-align="right" title="По правому краю">R</button>
        <button type="button" class="admin-icon-btn" data-align="top" title="По верхнему краю">T</button>
        <button type="button" class="admin-icon-btn" data-align="bottom" title="По нижнему краю">B</button>
        <button type="button" class="admin-icon-btn" data-align="vcenter" title="По центру вертикально">M</button>
        <button type="button" class="admin-icon-btn" data-align="distribute-x" title="Равные интервалы по горизонтали">H...</button>
        <button type="button" class="admin-icon-btn" data-align="distribute-y" title="Равные интервалы по вертикали">V...</button>
        <button type="button" class="admin-icon-btn" data-align="same-width" title="Одинаковая ширина">W</button>
        <button type="button" class="admin-icon-btn" data-align="same-height" title="Одинаковая высота">H</button>
      </div>
      <button type="button" class="admin-action-btn" data-align="same-size">Одинаковый размер</button>
      <div class="admin-section-title" style="margin-top:16px">Масштаб и направляющие</div>
      <div class="admin-zoom-row">
        <button type="button" class="admin-icon-btn" id="adminZoomOut" title="Уменьшить">-</button>
        <input id="adminZoom" type="range" min="30" max="200" value="100" step="5" aria-label="Масштаб холста">
        <button type="button" class="admin-icon-btn" id="adminZoomIn" title="Увеличить">+</button>
      </div>
      <label class="admin-check-row"><input type="checkbox" id="adminSnap" checked> Прилипание и расстояния</label>
      <canvas class="admin-minimap" id="adminMinimap" width="680" height="300" aria-label="Мини-карта холста"></canvas>
      <div class="admin-section-title" style="margin-top:14px">Мобильная безопасная зона</div>
      <select class="admin-select" id="adminDevicePreset">
        <option value="390">iPhone 14 / 15 — 390 px</option>
        <option value="430">iPhone Pro Max — 430 px</option>
        <option value="375">iPhone SE — 375 px</option>
        <option value="360">Android compact — 360 px</option>
      </select>
      <div class="admin-safe-status" id="adminSafeStatus">Переключись в Mobile для проверки</div>
      <div class="admin-section-title" style="margin-top:14px">Содержимое компонента</div>
      <input class="admin-field" id="adminComponentImage" type="text" placeholder="Путь к изображению">
      <select class="admin-select" id="adminComponentFit"><option value="">Авто</option><option value="cover">Cover</option><option value="contain">Contain</option></select>
      <input class="admin-field" id="adminComponentTitle" type="text" placeholder="Заголовок">
      <textarea class="admin-textarea" id="adminComponentText" placeholder="Подпись" style="min-height:64px"></textarea>
      <button type="button" class="admin-action-btn" id="adminApplyComponent">Применить к компоненту</button>
    </section>
    <section class="admin-panel" data-admin-panel="case">
      <select class="admin-select" id="adminCaseSelect" aria-label="Кейс"></select>
      <label class="admin-section-title" for="adminCaseTitle">Название</label>
      <input class="admin-field" id="adminCaseTitle" type="text">
      <label class="admin-section-title" for="adminCaseDesc">Описание</label>
      <textarea class="admin-textarea" id="adminCaseDesc"></textarea>
      <label class="admin-section-title" for="adminCaseTags">Теги через запятую</label>
      <input class="admin-field" id="adminCaseTags" type="text">
      <div class="admin-section-title">Аккордеоны</div>
      <div id="adminAccordionList"></div>
      <button type="button" class="admin-action-btn" id="adminAddAccordion">Добавить аккордеон</button>
      <button type="button" class="admin-action-btn" id="adminApplyCase" style="margin-top:6px;background:#fff;color:#111">Применить изменения</button>
    </section>
    <section class="admin-panel" data-admin-panel="gallery">
      <select class="admin-select" id="adminGallerySelect" aria-label="Галерея кейса"></select>
      <button type="button" class="admin-action-btn" id="adminAuditGallery">Проверить изображения</button>
      <div class="admin-safe-status" id="adminAssetAudit" style="margin:7px 0"></div>
      <div class="admin-gallery-list" id="adminGalleryList"></div>
      <button type="button" class="admin-action-btn" id="adminAddGallery" style="margin-top:8px">Добавить изображения</button>
      <input type="file" id="adminGalleryInput" accept="image/*,video/*" multiple hidden>
    </section>
    <section class="admin-panel" data-admin-panel="history">
      <button type="button" class="admin-action-btn" id="adminRunPreflight" style="margin-bottom:7px">Проверить перед публикацией</button>
      <div class="admin-preflight-list" id="adminPreflightList"></div>
      <div class="admin-history-actions">
        <button type="button" class="admin-action-btn" id="adminPreviewSite">Предпросмотр</button>
        <button type="button" class="admin-action-btn" id="adminPublishSite" style="background:#d4ff00;color:#111">Опубликовать</button>
        <button type="button" class="admin-action-btn" id="adminExportAll">Экспорт JSON</button>
        <button type="button" class="admin-action-btn" id="adminImportAll">Импорт JSON</button>
      </div>
      <input type="file" id="adminImportInput" accept="application/json,.json" hidden>
      <button type="button" class="admin-action-btn" id="adminCreateVersion">Сохранить версию сейчас</button>
      <div class="admin-history-list" id="adminHistoryList" style="margin-top:8px"></div>
    </section>
    <section class="admin-panel" data-admin-panel="trash">
      <div class="admin-section-title">Удалённые объекты</div>
      <div class="admin-history-list" id="adminTrashList"></div>
    </section>`;
  document.body.appendChild(workbench);

  const preview = document.createElement('div');
  preview.className = 'admin-asset-preview';
  preview.id = 'adminAssetPreview';
  preview.innerHTML = '<img alt="Предпросмотр"><video muted loop playsinline controls></video><div class="admin-asset-preview-meta"></div>';
  document.body.appendChild(preview);

  const guideV = document.createElement('div');
  guideV.className = 'admin-guide-line vertical';
  const guideH = document.createElement('div');
  guideH.className = 'admin-guide-line horizontal';
  const distanceLabel = document.createElement('div');
  distanceLabel.className = 'admin-distance-label';
  api.getCanvas().world.append(guideV, guideH);
  document.body.appendChild(distanceLabel);

  const lasso = document.createElement('div');
  lasso.className = 'admin-lasso';
  document.body.appendChild(lasso);
  const safeFrame = document.createElement('div');
  safeFrame.className = 'admin-mobile-safe-frame';
  api.getCanvas().world.appendChild(safeFrame);

  const saveState = document.getElementById('adminSaveState');
  const layerList = document.getElementById('adminLayerList');
  const caseSelect = document.getElementById('adminCaseSelect');
  const gallerySelect = document.getElementById('adminGallerySelect');
  const caseTitle = document.getElementById('adminCaseTitle');
  const caseDesc = document.getElementById('adminCaseDesc');
  const caseTags = document.getElementById('adminCaseTags');
  const accordionList = document.getElementById('adminAccordionList');
  const galleryList = document.getElementById('adminGalleryList');
  const zoomInput = document.getElementById('adminZoom');
  const publishState = document.getElementById('adminPublishState');
  const minimap = document.getElementById('adminMinimap');
  let minimapTransform = null;

  function getLayerName(el) {
    const id = api.getElementId(el);
    if (layerMeta[id] && layerMeta[id].name) return layerMeta[id].name;
    const type = id.startsWith('badge-') ? 'Подпись' : id.startsWith('tag-') ? 'Тег' : 'Карточка';
    return `${type}: ${projects[el.dataset.project]?.title || el.dataset.project}`;
  }

  function applyLayerMeta() {
    api.getElements().forEach(el => {
      const meta = layerMeta[api.getElementId(el)] || {};
      el.classList.toggle('admin-object-hidden', Boolean(meta.hidden));
      el.classList.toggle('admin-object-locked', Boolean(meta.locked));
      el.classList.toggle('admin-object-deleted', Boolean(meta.deleted));
    });
  }

  function layerType(el) {
    const id = api.getElementId(el);
    if (id.startsWith('badge-') || el.className.includes('badge-')) return 'badge';
    if (id.startsWith('tag-') || el.className.includes('tag-')) return 'tag';
    return 'card';
  }

  function createLayerRow(el, selected) {
    const id = api.getElementId(el);
    const meta = layerMeta[id] || {};
    const row = document.createElement('div');
    row.className = 'admin-layer-row';
    row.dataset.layerId = id;
    row.classList.toggle('selected', selected.has(el));
    row.classList.toggle('locked', Boolean(meta.locked));
    row.classList.toggle('hidden', Boolean(meta.hidden));
    row.innerHTML = `
      <input type="checkbox" aria-label="Выбрать ${escapeHtml(getLayerName(el))}" ${selected.has(el) ? 'checked' : ''}>
      <input class="admin-layer-name" type="text" value="${escapeHtml(getLayerName(el))}" aria-label="Название слоя">
      <button type="button" class="admin-layer-action" data-layer-action="visibility" title="${meta.hidden ? 'Показать' : 'Скрыть'}">${meta.hidden ? 'O' : '-'}</button>
      <button type="button" class="admin-layer-action" data-layer-action="lock" title="${meta.locked ? 'Разблокировать' : 'Заблокировать'}">${meta.locked ? 'X' : 'U'}</button>`;

    row.querySelector('input[type="checkbox"]').addEventListener('change', event => {
      api.select(el, true, !event.target.checked);
      if (event.target.checked && !api.getSelected().includes(el)) api.select(el, true, false);
      syncLayerSelection();
    });
    row.querySelector('.admin-layer-name').addEventListener('change', event => {
      layerMeta[id] = Object.assign({}, layerMeta[id], { name: event.target.value.trim() || id });
      scheduleSave('Переименование слоя');
    });
    row.querySelector('[data-layer-action="visibility"]').addEventListener('click', () => {
      layerMeta[id] = Object.assign({}, layerMeta[id], { hidden: !meta.hidden });
      applyLayerMeta();
      renderLayers();
      scheduleSave('Видимость слоя');
    });
    row.querySelector('[data-layer-action="lock"]').addEventListener('click', () => {
      layerMeta[id] = Object.assign({}, layerMeta[id], { locked: !meta.locked });
      applyLayerMeta();
      renderLayers();
      scheduleSave('Блокировка слоя');
    });
    row.addEventListener('click', event => {
      if (event.target.closest('button, input')) return;
      api.select(el, event.shiftKey, event.shiftKey);
    });
    return row;
  }

  function renderLayers() {
    layerList.innerHTML = '';
    const selected = new Set(api.getSelected());
    const search = (document.getElementById('adminLayerSearch').value || '').trim().toLowerCase();
    const type = document.getElementById('adminLayerType').value;
    const groups = new Map();

    api.getElements().forEach(el => {
      if (layerMeta[api.getElementId(el)]?.deleted) return;
      if (type !== 'all' && layerType(el) !== type) return;
      if (search && !getLayerName(el).toLowerCase().includes(search)) return;
      const key = el.dataset.project || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });

    groups.forEach((elements, projectKey) => {
      const group = document.createElement('div');
      group.className = 'admin-layer-group';
      group.dataset.layerGroup = projectKey;
      group.classList.toggle('collapsed', collapsedGroups.has(projectKey));
      const allSelected = elements.every(el => selected.has(el));
      const allHidden = elements.every(el => layerMeta[api.getElementId(el)]?.hidden);
      const allLocked = elements.every(el => layerMeta[api.getElementId(el)]?.locked);
      group.innerHTML = `
        <div class="admin-layer-group-header">
          <input type="checkbox" aria-label="Выбрать группу" ${allSelected ? 'checked' : ''}>
          <button type="button" class="admin-layer-action" data-group-action="collapse" title="Свернуть">${collapsedGroups.has(projectKey) ? '+' : '-'}</button>
          <span>${escapeHtml(projects[projectKey]?.title || projectKey)} (${elements.length})</span>
          <button type="button" class="admin-layer-action" data-group-action="visibility" title="Видимость группы">${allHidden ? 'O' : '-'}</button>
          <button type="button" class="admin-layer-action" data-group-action="lock" title="Блокировка группы">${allLocked ? 'X' : 'U'}</button>
        </div>
        <div class="admin-layer-group-items"></div>`;
      group.querySelector('input[type="checkbox"]').addEventListener('change', event => {
        if (!event.target.checked) {
          elements.forEach(el => { if (api.getSelected().includes(el)) api.select(el, true, true); });
        } else {
          elements.forEach(el => { if (!api.getSelected().includes(el)) api.select(el, true, false); });
        }
        syncLayerSelection();
      });
      group.querySelector('[data-group-action="collapse"]').addEventListener('click', () => {
        if (collapsedGroups.has(projectKey)) collapsedGroups.delete(projectKey);
        else collapsedGroups.add(projectKey);
        renderLayers();
      });
      group.querySelector('[data-group-action="visibility"]').addEventListener('click', () => {
        elements.forEach(el => {
          const id = api.getElementId(el);
          layerMeta[id] = Object.assign({}, layerMeta[id], { hidden: !allHidden });
        });
        applyLayerMeta();
        renderLayers();
        scheduleSave('Видимость группы');
      });
      group.querySelector('[data-group-action="lock"]').addEventListener('click', () => {
        elements.forEach(el => {
          const id = api.getElementId(el);
          layerMeta[id] = Object.assign({}, layerMeta[id], { locked: !allLocked });
        });
        applyLayerMeta();
        renderLayers();
        scheduleSave('Блокировка группы');
      });
      const items = group.querySelector('.admin-layer-group-items');
      elements.forEach(el => items.appendChild(createLayerRow(el, selected)));
      layerList.appendChild(group);
    });
    if (!groups.size) layerList.textContent = 'Ничего не найдено';
  }

  function syncLayerSelection() {
    const selected = new Set(api.getSelected());
    layerList.querySelectorAll('.admin-layer-row').forEach(row => {
      const el = api.getElements().find(item => api.getElementId(item) === row.dataset.layerId);
      const active = selected.has(el);
      row.classList.toggle('selected', active);
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = active;
    });
    layerList.querySelectorAll('.admin-layer-group').forEach(group => {
      const elements = api.getElements().filter(el => el.dataset.project === group.dataset.layerGroup);
      const checkbox = group.querySelector('.admin-layer-group-header input[type="checkbox"]');
      if (checkbox) checkbox.checked = elements.length > 0 && elements.every(el => selected.has(el));
    });
    syncCoordinateFields();
    renderMiniMap();
  }

  function rotationOf(el) {
    const transform = el.style.transform || getComputedStyle(el).transform || '';
    const match = transform.match(/rotate\(([-\d.]+)deg\)/);
    return match ? Number(match[1]) : 0;
  }

  function syncCoordinateFields() {
    const el = api.getSelected().at(-1);
    const ids = ['adminCoordX', 'adminCoordY', 'adminCoordR', 'adminCoordW', 'adminCoordH'];
    if (!el) {
      ids.forEach(id => { document.getElementById(id).value = ''; });
      return;
    }
    const box = objectBox(el);
    document.getElementById('adminCoordX').value = Math.round(box.left);
    document.getElementById('adminCoordY').value = Math.round(box.top);
    document.getElementById('adminCoordR').value = Math.round(rotationOf(el) * 100) / 100;
    document.getElementById('adminCoordW').value = Math.round(box.width);
    document.getElementById('adminCoordH').value = Math.round(box.height);
    const img = el.querySelector('img');
    const heading = el.querySelector('h4');
    const paragraph = el.querySelector('p');
    document.getElementById('adminComponentImage').value = img?.getAttribute('src') || '';
    document.getElementById('adminComponentFit').value = img?.style.objectFit || '';
    document.getElementById('adminComponentTitle').value = heading?.textContent || '';
    document.getElementById('adminComponentText').value = paragraph?.textContent || '';
  }

  function applyCoordinate(property, value) {
    const selected = selectedUnlocked();
    if (!selected.length || !Number.isFinite(value)) return;
    api.pushUndo();
    const reference = objectBox(selected.at(-1));
    selected.forEach(el => {
      const box = objectBox(el);
      if (property === 'x') setLength(el, 'left', box.left + value - reference.left);
      if (property === 'y') setLength(el, 'top', box.top + value - reference.top);
      if (property === 'width') setLength(el, 'width', value);
      if (property === 'height') setLength(el, 'height', value);
      if (property === 'rotate') {
        const current = el.style.transform || '';
        el.style.transform = /rotate\([^)]*\)/.test(current)
          ? current.replace(/rotate\([^)]*\)/, `rotate(${value}deg)`)
          : `${current} rotate(${value}deg)`.trim();
      }
    });
    checkMobileBounds();
    scheduleSave('Точные параметры объекта');
  }

  function applyComponentFields() {
    const imageValue = document.getElementById('adminComponentImage').value.trim();
    const fitValue = document.getElementById('adminComponentFit').value;
    const titleValue = document.getElementById('adminComponentTitle').value;
    const textValue = document.getElementById('adminComponentText').value;
    const selected = selectedUnlocked();
    if (!selected.length) return;
    api.pushUndo();
    selected.forEach(el => {
      const img = el.querySelector('img');
      if (img && imageValue) img.setAttribute('src', imageValue);
      if (img) img.style.objectFit = fitValue;
      const heading = el.querySelector('h4');
      const paragraph = el.querySelector('p');
      if (heading) heading.textContent = titleValue;
      if (paragraph) paragraph.textContent = textValue;
    });
    scheduleSave('Содержимое компонента');
  }

  let lassoStart = null;
  document.addEventListener('mousedown', event => {
    if (!lassoMode || !api.isActive() || event.button !== 0) return;
    const viewport = event.target.closest('.canvas-viewport');
    if (!viewport || event.target.closest('[data-project]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    lassoStart = { x: event.clientX, y: event.clientY };
    lasso.style.left = `${event.clientX}px`;
    lasso.style.top = `${event.clientY}px`;
    lasso.style.width = '0px';
    lasso.style.height = '0px';
    lasso.style.display = 'block';
  }, true);

  document.addEventListener('mousemove', event => {
    if (!lassoStart) return;
    const left = Math.min(lassoStart.x, event.clientX);
    const top = Math.min(lassoStart.y, event.clientY);
    lasso.style.left = `${left}px`;
    lasso.style.top = `${top}px`;
    lasso.style.width = `${Math.abs(event.clientX - lassoStart.x)}px`;
    lasso.style.height = `${Math.abs(event.clientY - lassoStart.y)}px`;
  }, true);

  document.addEventListener('mouseup', event => {
    if (!lassoStart) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selectionRect = lasso.getBoundingClientRect();
    api.deselect();
    api.getElements().forEach(el => {
      if (el.classList.contains('admin-object-hidden')) return;
      const rect = el.getBoundingClientRect();
      const intersects = rect.right >= selectionRect.left && rect.left <= selectionRect.right &&
        rect.bottom >= selectionRect.top && rect.top <= selectionRect.bottom;
      if (intersects) api.select(el, true, false);
    });
    lassoStart = null;
    lasso.style.display = 'none';
    syncLayerSelection();
  }, true);

  function selectedUnlocked() {
    return api.getSelected().filter(el =>
      !el.classList.contains('admin-object-locked') &&
      !el.classList.contains('admin-object-hidden') &&
      !el.classList.contains('admin-object-deleted')
    );
  }

  function moveSelectionToTrash() {
    const selected = api.getSelected();
    if (!selected.length) return;
    selected.forEach(el => {
      const id = api.getElementId(el);
      layerMeta[id] = Object.assign({}, layerMeta[id], { deleted: true });
    });
    api.deselect();
    applyLayerMeta();
    renderAll();
    scheduleSave('Объекты перемещены в корзину');
  }

  function renderTrash() {
    const container = document.getElementById('adminTrashList');
    container.innerHTML = '';
    const deleted = api.getElements().filter(el => layerMeta[api.getElementId(el)]?.deleted);
    deleted.forEach(el => {
      const id = api.getElementId(el);
      const row = document.createElement('div');
      row.className = 'admin-history-item';
      row.innerHTML = `<span>${escapeHtml(getLayerName(el))}</span><button type="button" class="admin-action-btn" style="width:auto">Восстановить</button>`;
      row.querySelector('button').addEventListener('click', () => {
        layerMeta[id] = Object.assign({}, layerMeta[id], { deleted: false });
        applyLayerMeta();
        renderAll();
        scheduleSave('Восстановление из корзины');
      });
      container.appendChild(row);
    });
    if (!deleted.length) container.textContent = 'Корзина пуста';
  }

  function objectBox(el) {
    const cs = getComputedStyle(el);
    const left = parseFloat(el.style.left) || parseFloat(cs.left) || 0;
    const top = parseFloat(el.style.top) || parseFloat(cs.top) || 0;
    return { el, left, top, width: el.offsetWidth, height: el.offsetHeight };
  }

  function projectColor(key) {
    const palette = ['#00c8ff', '#d4ff00', '#ff6b8a', '#ffd166', '#70e000', '#f5f5f5', '#8ecae6'];
    const hash = String(key || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return palette[hash % palette.length];
  }

  function renderMiniMap() {
    const context = minimap.getContext('2d');
    const elements = api.getElements().filter(el => {
      const meta = layerMeta[api.getElementId(el)] || {};
      return !meta.hidden && !meta.deleted && getComputedStyle(el).display !== 'none';
    });
    context.clearRect(0, 0, minimap.width, minimap.height);
    context.fillStyle = '#0b0b0b';
    context.fillRect(0, 0, minimap.width, minimap.height);
    if (!elements.length) return;
    const boxes = elements.map(objectBox);
    const padding = 160;
    const minX = Math.min(...boxes.map(box => box.left)) - padding;
    const minY = Math.min(...boxes.map(box => box.top)) - padding;
    const maxX = Math.max(...boxes.map(box => box.left + box.width)) + padding;
    const maxY = Math.max(...boxes.map(box => box.top + box.height)) + padding;
    const scaleX = minimap.width / Math.max(1, maxX - minX);
    const scaleY = minimap.height / Math.max(1, maxY - minY);
    const mapScale = Math.min(scaleX, scaleY);
    const offsetX = (minimap.width - (maxX - minX) * mapScale) / 2;
    const offsetY = (minimap.height - (maxY - minY) * mapScale) / 2;
    minimapTransform = { minX, minY, mapScale, offsetX, offsetY };
    const selected = new Set(api.getSelected());
    boxes.forEach(box => {
      const x = offsetX + (box.left - minX) * mapScale;
      const y = offsetY + (box.top - minY) * mapScale;
      const width = Math.max(3, box.width * mapScale);
      const height = Math.max(3, box.height * mapScale);
      context.fillStyle = projectColor(box.el.dataset.project);
      context.globalAlpha = selected.has(box.el) ? 1 : 0.66;
      context.fillRect(x, y, width, height);
      if (selected.has(box.el)) {
        context.strokeStyle = '#fff';
        context.lineWidth = 2;
        context.strokeRect(x - 2, y - 2, width + 4, height + 4);
      }
    });
    context.globalAlpha = 1;
    if (viewMode === 'desktop') {
      const canvas = api.getCanvas();
      const worldLeft = -canvas.panX / canvas.scale;
      const worldTop = -canvas.panY / canvas.scale;
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.strokeRect(
        offsetX + (worldLeft - minX) * mapScale,
        offsetY + (worldTop - minY) * mapScale,
        canvas.viewport.clientWidth / canvas.scale * mapScale,
        canvas.viewport.clientHeight / canvas.scale * mapScale
      );
    }
  }

  function setLength(el, property, value) {
    api.setStyle(el, property, `${Math.round(value * 100) / 100}px`);
  }

  function alignSelection(command) {
    const items = selectedUnlocked().map(objectBox);
    if (items.length < 2) return;
    api.pushUndo();
    const minLeft = Math.min(...items.map(item => item.left));
    const maxRight = Math.max(...items.map(item => item.left + item.width));
    const minTop = Math.min(...items.map(item => item.top));
    const maxBottom = Math.max(...items.map(item => item.top + item.height));
    const centerX = (minLeft + maxRight) / 2;
    const centerY = (minTop + maxBottom) / 2;

    items.forEach(item => {
      if (command === 'left') setLength(item.el, 'left', minLeft);
      if (command === 'right') setLength(item.el, 'left', maxRight - item.width);
      if (command === 'hcenter') setLength(item.el, 'left', centerX - item.width / 2);
      if (command === 'top') setLength(item.el, 'top', minTop);
      if (command === 'bottom') setLength(item.el, 'top', maxBottom - item.height);
      if (command === 'vcenter') setLength(item.el, 'top', centerY - item.height / 2);
      if (command === 'same-width' || command === 'same-size') setLength(item.el, 'width', items[0].width);
      if (command === 'same-height' || command === 'same-size') setLength(item.el, 'height', items[0].height);
    });

    if (command === 'distribute-x') {
      const sorted = items.slice().sort((a, b) => a.left - b.left);
      const occupied = sorted.reduce((sum, item) => sum + item.width, 0);
      const gap = (maxRight - minLeft - occupied) / (sorted.length - 1);
      let cursor = minLeft;
      sorted.forEach(item => {
        setLength(item.el, 'left', cursor);
        cursor += item.width + gap;
      });
    }
    if (command === 'distribute-y') {
      const sorted = items.slice().sort((a, b) => a.top - b.top);
      const occupied = sorted.reduce((sum, item) => sum + item.height, 0);
      const gap = (maxBottom - minTop - occupied) / (sorted.length - 1);
      let cursor = minTop;
      sorted.forEach(item => {
        setLength(item.el, 'top', cursor);
        cursor += item.height + gap;
      });
    }
    scheduleSave('Выравнивание группы');
  }

  function stripEditorChrome(el) {
    el.classList.remove('editing', 'grouped', 'admin-object-hidden', 'admin-object-locked', 'admin-outside-safe');
    el.querySelectorAll('.edit-rotate-handle, .edit-resize-handle, .edit-group-indicator').forEach(node => node.remove());
    return el;
  }

  function serializeCustomObjects() {
    return Array.from(document.querySelectorAll('[data-admin-generated="true"]')).map(el => {
      const clean = stripEditorChrome(el.cloneNode(true));
      const desktopCss = viewMode !== 'desktop'
        ? (desktopStyleCache.get(el) || el.dataset.adminDesktopStyle || clean.style.cssText)
        : clean.style.cssText;
      clean.style.cssText = desktopCss;
      clean.dataset.adminDesktopStyle = desktopCss;
      return clean.outerHTML;
    });
  }

  function applyCustomObjects(items) {
    document.querySelectorAll('[data-admin-generated="true"]').forEach(el => el.remove());
    (items || []).forEach(html => {
      const template = document.createElement('template');
      template.innerHTML = html.trim();
      const el = template.content.firstElementChild;
      if (!el) return;
      stripEditorChrome(el);
      api.getCanvas().world.appendChild(el);
      if (el.dataset.adminDesktopStyle) desktopStyleCache.set(el, el.dataset.adminDesktopStyle);
      if (api.isActive()) api.addHandles(el);
    });
  }

  function cloneObjects(elements, offset) {
    const created = [];
    elements.forEach((source, index) => {
      const cloneEl = stripEditorChrome(source.cloneNode(true));
      const box = objectBox(source);
      cloneEl.dataset.adminId = `copy-${Date.now()}-${index}-${Math.floor(Math.random() * 10000)}`;
      cloneEl.dataset.adminGenerated = 'true';
      api.setStyle(cloneEl, 'left', `${box.left + offset}px`);
      api.setStyle(cloneEl, 'top', `${box.top + offset}px`);
      if (viewMode !== 'desktop') {
        const desktopProbe = stripEditorChrome(source.cloneNode(true));
        desktopProbe.style.cssText = desktopStyleCache.get(source) || source.dataset.adminDesktopStyle || source.style.cssText;
        const desktopLeft = parseFloat(desktopProbe.style.left) || 0;
        const desktopTop = parseFloat(desktopProbe.style.top) || 0;
        desktopProbe.style.left = `${desktopLeft + offset}px`;
        desktopProbe.style.top = `${desktopTop + offset}px`;
        cloneEl.dataset.adminDesktopStyle = desktopProbe.style.cssText;
        desktopStyleCache.set(cloneEl, desktopProbe.style.cssText);
      } else {
        cloneEl.dataset.adminDesktopStyle = cloneEl.style.cssText;
      }
      api.getCanvas().world.appendChild(cloneEl);
      api.addHandles(cloneEl);
      created.push(cloneEl);
    });
    if (created.length) {
      api.deselect();
      created.forEach(el => api.select(el, true, false));
      renderLayers();
      scheduleSave('Дублирование объектов');
    }
    return created;
  }

  function copySelection() {
    copiedObjects = selectedUnlocked().map(el => {
      const copied = stripEditorChrome(el.cloneNode(true));
      if (viewMode !== 'desktop') copied.dataset.adminDesktopStyle = desktopStyleCache.get(el) || el.dataset.adminDesktopStyle || '';
      return copied;
    });
    saveState.textContent = `Скопировано: ${copiedObjects.length}`;
  }

  function pasteSelection() {
    if (!copiedObjects.length) return;
    cloneObjects(copiedObjects, 36);
  }

  function duplicateSelection() {
    cloneObjects(selectedUnlocked(), 36);
  }

  function nudgeSelection(dx, dy) {
    const selected = selectedUnlocked();
    if (!selected.length) return;
    api.pushUndo();
    selected.forEach(el => {
      const box = objectBox(el);
      setLength(el, 'left', box.left + dx);
      setLength(el, 'top', box.top + dy);
    });
    checkMobileBounds();
    scheduleSave('Точное позиционирование');
  }

  function responsiveRulesFor(el, targetWidth) {
    const values = {};
    const props = ['top', 'left', 'right', 'bottom', 'width', 'height', 'transform', 'translate', 'display', 'z-index'];
    function conditionMatches(condition) {
      const max = [...String(condition).matchAll(/max-width\s*:\s*(\d+)px/gi)].map(match => Number(match[1]));
      const min = [...String(condition).matchAll(/min-width\s*:\s*(\d+)px/gi)].map(match => Number(match[1]));
      return (!max.length || max.every(value => targetWidth <= value)) && (!min.length || min.every(value => targetWidth >= value));
    }
    function walk(rules, active) {
      Array.from(rules || []).forEach(rule => {
        if (rule.type === CSSRule.MEDIA_RULE) {
          const matches = conditionMatches(rule.conditionText || '');
          walk(rule.cssRules, active === undefined ? matches : active && matches);
          return;
        }
        if (active !== true || rule.type !== CSSRule.STYLE_RULE) return;
        try {
          if (!el.matches(rule.selectorText)) return;
          props.forEach(prop => {
            const value = rule.style.getPropertyValue(prop);
            if (value) values[prop] = value;
          });
        } catch (error) {}
      });
    }
    Array.from(document.styleSheets).forEach(sheet => {
      try { walk(sheet.cssRules, undefined); } catch (error) {}
    });
    return values;
  }

  function capturePositions() {
    const positions = {};
    api.getElements().forEach(el => {
      const cs = getComputedStyle(el);
      positions[api.getElementId(el)] = {
        top: el.style.getPropertyValue('top') || cs.top,
        left: el.style.getPropertyValue('left') || cs.left,
        transform: el.style.getPropertyValue('transform') || cs.transform,
        translate: el.style.getPropertyValue('translate') || cs.translate
      };
    });
    return positions;
  }

  function applyPositionMap(map) {
    api.getElements().forEach(el => {
      const item = map[api.getElementId(el)];
      if (!item) return;
      if (item.top) api.setStyle(el, 'top', item.top);
      if (item.left) api.setStyle(el, 'left', item.left);
      if (item.transform && item.transform !== 'none') api.setStyle(el, 'transform', item.transform);
      if (item.translate && item.translate !== 'none') api.setStyle(el, 'translate', item.translate);
    });
  }

  function setMobilePreset(width) {
    const value = Math.max(320, Math.min(1024, Number(width) || 390));
    document.body.style.setProperty('--admin-mobile-width', `${value}px`);
    safeFrame.style.width = `${value}px`;
    checkMobileBounds();
  }

  function checkMobileBounds() {
    const status = document.getElementById('adminSafeStatus');
    api.getElements().forEach(el => el.classList.remove('admin-outside-safe'));
    if (viewMode === 'desktop') {
      status.textContent = 'Переключись в Tablet или Mobile';
      status.classList.remove('warning');
      return;
    }
    const width = viewMode === 'tablet' ? 820 : (Number(document.getElementById('adminDevicePreset').value) || 390);
    const outside = api.getElements().filter(el => {
      if (el.classList.contains('admin-object-hidden') || getComputedStyle(el).display === 'none') return false;
      const box = objectBox(el);
      return box.left < 0 || box.left + box.width > width;
    });
    outside.forEach(el => el.classList.add('admin-outside-safe'));
    status.textContent = outside.length ? `За границей экрана: ${outside.length}` : `Все объекты внутри ${width}px`;
    status.classList.toggle('warning', outside.length > 0);
  }

  function switchView(nextMode) {
    if (nextMode === viewMode) return;
    hideGuides();
    if (viewMode === 'desktop') {
      responsive.desktop = capturePositions();
      responsive.desktopState = api.captureState();
      desktopStyleCache = new Map(api.getElements().map(el => [el, el.style.cssText]));
    } else {
      responsive[viewMode] = capturePositions();
      document.body.classList.remove('admin-mobile-edit', 'admin-tablet-edit');
      desktopStyleCache.forEach((cssText, el) => { el.style.cssText = cssText; });
    }

    if (nextMode !== 'desktop') {
      const targetWidth = nextMode === 'tablet' ? 820 : (Number(document.getElementById('adminDevicePreset').value) || 390);
      document.body.classList.add('admin-mobile-edit');
      document.body.classList.toggle('admin-tablet-edit', nextMode === 'tablet');
      setMobilePreset(targetWidth);
      api.setZoom(1);
      api.setPan(0, 0);
      api.getElements().forEach(el => {
        const rules = responsiveRulesFor(el, targetWidth);
        Object.entries(rules).forEach(([property, value]) => el.style.setProperty(property, value, 'important'));
      });
      applyPositionMap(responsive[nextMode] || {});
    } else {
      document.body.classList.remove('admin-mobile-edit', 'admin-tablet-edit');
      applyPositionMap(responsive.desktop || {});
    }
    viewMode = nextMode;
    workbench.querySelectorAll('[data-admin-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminView === viewMode);
    });
    zoomInput.disabled = viewMode !== 'desktop';
    checkMobileBounds();
    scheduleSave(`Режим ${nextMode}`);
  }

  function hideGuides() {
    guideV.style.display = 'none';
    guideH.style.display = 'none';
    distanceLabel.style.display = 'none';
  }

  window.__portfolioAdminSnap = function(items, dx, dy, event) {
    if (!snapEnabled || !items.length) {
      hideGuides();
      return { dx, dy };
    }
    const selected = new Set(items.map(item => item.el));
    const moving = items.map(item => ({
      left: item.left + dx,
      top: item.top + dy,
      width: item.el.offsetWidth,
      height: item.el.offsetHeight
    }));
    const group = {
      left: Math.min(...moving.map(item => item.left)),
      top: Math.min(...moving.map(item => item.top)),
      right: Math.max(...moving.map(item => item.left + item.width)),
      bottom: Math.max(...moving.map(item => item.top + item.height))
    };
    const canvas = api.getCanvas();
    const xTargets = [];
    const yTargets = [];
    api.getElements().filter(el => !selected.has(el) && !el.classList.contains('admin-object-hidden')).forEach(el => {
      const box = objectBox(el);
      xTargets.push(box.left, box.left + box.width / 2, box.left + box.width);
      yTargets.push(box.top, box.top + box.height / 2, box.top + box.height);
    });
    xTargets.push((-canvas.panX + canvas.viewport.clientWidth / 2) / canvas.scale);
    yTargets.push((-canvas.panY + canvas.viewport.clientHeight / 2) / canvas.scale);
    if (gridEnabled) {
      const step = Math.max(1, Number(document.getElementById('adminGridStep').value) || 8);
      xTargets.push(Math.round(group.left / step) * step);
      yTargets.push(Math.round(group.top / step) * step);
    }
    const xPoints = [group.left, (group.left + group.right) / 2, group.right];
    const yPoints = [group.top, (group.top + group.bottom) / 2, group.bottom];
    const threshold = 9 / Math.max(canvas.scale, 0.3);
    let bestX = null;
    let bestY = null;
    xTargets.forEach(target => xPoints.forEach(point => {
      const delta = target - point;
      if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { target, delta };
    }));
    yTargets.forEach(target => yPoints.forEach(point => {
      const delta = target - point;
      if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { target, delta };
    }));
    if (bestX) {
      dx += bestX.delta;
      guideV.style.left = `${bestX.target}px`;
      guideV.style.display = 'block';
    } else {
      guideV.style.display = 'none';
    }
    if (bestY) {
      dy += bestY.delta;
      guideH.style.top = `${bestY.target}px`;
      guideH.style.display = 'block';
    } else {
      guideH.style.display = 'none';
    }
    distanceLabel.textContent = `${Math.round(dx)} x ${Math.round(dy)} px`;
    distanceLabel.style.left = `${event.clientX + 14}px`;
    distanceLabel.style.top = `${event.clientY + 14}px`;
    distanceLabel.style.display = 'block';
    return { dx, dy };
  };

  function projectOptions() {
    return Object.entries(projects).map(([key, project]) =>
      `<option value="${escapeHtml(key)}">${escapeHtml(project.title || key)}</option>`
    ).join('');
  }

  function renderProjectSelects() {
    const options = projectOptions();
    caseSelect.innerHTML = options;
    gallerySelect.innerHTML = options;
    if (!projects[caseKey]) caseKey = Object.keys(projects)[0] || '';
    caseSelect.value = caseKey;
    gallerySelect.value = caseKey;
  }

  function renderCaseEditor() {
    const project = projects[caseKey];
    if (!project) return;
    caseSelect.value = caseKey;
    caseTitle.value = project.title || '';
    caseDesc.value = project.desc || '';
    caseTags.value = (project.tags || []).join(', ');
    accordionList.innerHTML = '';
    (project.accordions || []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'admin-accordion-editor';
      row.innerHTML = `
        <button type="button" class="admin-remove-row" title="Удалить">x</button>
        <input class="admin-field" type="text" value="${escapeHtml(item.label || '')}" data-accordion-label="${index}" aria-label="Заголовок аккордеона">
        <textarea class="admin-textarea" data-accordion-content="${index}" aria-label="Текст аккордеона">${escapeHtml(item.content || '')}</textarea>`;
      row.querySelector('.admin-remove-row').addEventListener('click', () => {
        project.accordions.splice(index, 1);
        renderCaseEditor();
        scheduleSave('Удаление аккордеона');
      });
      accordionList.appendChild(row);
    });
  }

  function collectCaseForm() {
    const project = projects[caseKey];
    if (!project) return;
    project.title = caseTitle.value.trim() || project.title;
    project.desc = caseDesc.value.trim();
    project.tags = caseTags.value.split(',').map(tag => tag.trim()).filter(Boolean);
    project.accordions = Array.from(accordionList.querySelectorAll('.admin-accordion-editor')).map(row => ({
      label: row.querySelector('[data-accordion-label]').value.trim() || 'Раздел',
      content: row.querySelector('[data-accordion-content]').value
    }));
    updateCanvasProject(caseKey);
    persistCases();
    renderProjectSelects();
    if (window.__currentOpenProject === caseKey && window.openDetail) window.openDetail(caseKey);
    scheduleSave('Редактирование кейса');
  }

  function updateCanvasProject(key) {
    const project = projects[key];
    const badge = document.querySelector(`.badge-${CSS.escape(key)} h4`);
    if (badge) badge.textContent = project.title || key;
    const tags = Array.from(document.querySelectorAll(`[data-project="${CSS.escape(key)}"][class*="tag-"]`));
    tags.forEach((tag, index) => {
      if (project.tags && project.tags[index]) tag.textContent = project.tags[index];
    });
  }

  function savedCases() {
    const output = {};
    Object.entries(projects).forEach(([key, project]) => {
      output[key] = {
        title: project.title || '',
        desc: project.desc || '',
        tags: clone(project.tags || []),
        accordions: clone(project.accordions || []),
        gallery: clone(project.gallery || []),
        cover: project.cover || null
      };
    });
    return output;
  }

  function applyCases(data) {
    Object.entries(data || {}).forEach(([key, value]) => {
      if (!projects[key]) return;
      ['title', 'desc', 'tags', 'accordions', 'gallery', 'cover'].forEach(field => {
        if (value[field] != null) projects[key][field] = clone(value[field]);
      });
      updateCanvasProject(key);
    });
  }

  function pinOzonGalleryAdditions() {
    const project = projects.ozon;
    if (!project || !Array.isArray(project.gallery)) return;
    const additions = [
      'Ozon/Frame 20873272348.png',
      'Ozon/Frame 2136138758.png',
      'Ozon/gift-card-flow-hq.png'
    ];
    const oldLowResolution = 'Интерфейсы/2026-04-12 23.13.59.jpg';
    const reordered = project.gallery.filter(src => !additions.includes(src) && src !== oldLowResolution);
    reordered.splice(2, 0, ...additions);
    project.gallery = reordered;

    const cases = readJSON(CASE_KEY, {});
    if (cases.ozon) {
      cases.ozon.gallery = clone(reordered);
      writeJSON(CASE_KEY, cases);
    }
    const draft = readJSON(DRAFT_KEY, null);
    if (draft?.cases?.ozon) {
      draft.cases.ozon.gallery = clone(reordered);
      writeJSON(DRAFT_KEY, draft);
    }
    const legacy = readJSON('portfolio-project-edits', {});
    if (legacy.ozon) {
      legacy.ozon.gallery = clone(reordered);
      writeJSON('portfolio-project-edits', legacy);
    }
  }

  function appendUiConceptAdditions() {
    const project = projects.ui;
    if (!project || !Array.isArray(project.gallery)) return;
    const additions = [
      'Ozon/gift-card-flow-hq.png',
      'UI/bank-runway-onboarding.png',
      'UI/bank-runway-dashboard.png',
      'UI/bank-runway-chat.png'
    ];
    const oldLowResolution = 'Интерфейсы/2026-04-12 23.13.59.jpg';
    const reordered = project.gallery.filter(src => !additions.includes(src) && src !== oldLowResolution);
    reordered.splice(4, 0, ...additions);
    project.gallery = reordered;

    const cases = readJSON(CASE_KEY, {});
    if (cases.ui) {
      cases.ui.gallery = clone(reordered);
      writeJSON(CASE_KEY, cases);
    }
    const draft = readJSON(DRAFT_KEY, null);
    if (draft?.cases?.ui) {
      draft.cases.ui.gallery = clone(reordered);
      writeJSON(DRAFT_KEY, draft);
    }
    const legacy = readJSON('portfolio-project-edits', {});
    if (legacy.ui) {
      legacy.ui.gallery = clone(reordered);
      writeJSON('portfolio-project-edits', legacy);
    }
  }

  function appendHomigoGalleryAdditions() {
    const project = projects.tbank;
    if (!project || !Array.isArray(project.gallery)) return;
    const videos = [
      'Homigo/bc27b365-3103be2b.mp4',
      'Homigo/Форма_размещения_жилья (1080p).mp4',
      'Homigo/Жилье_—_карточка (1080p).mp4'
    ];
    const photos = ['Homigo/Frame 277131464.png', 'Homigo/Slide 16_9 - 75.png'];
    const additions = [...videos, ...photos];
    const duplicateCover = 'Homigo/image 1926988951.webp';
    const reordered = project.gallery.filter(src => !additions.includes(src) && src !== duplicateCover);
    reordered.splice(1, 0, ...videos);
    reordered.push(...photos);
    project.gallery = reordered;

    const cases = readJSON(CASE_KEY, {});
    if (cases.tbank) {
      cases.tbank.gallery = clone(reordered);
      writeJSON(CASE_KEY, cases);
    }
    const draft = readJSON(DRAFT_KEY, null);
    if (draft?.cases?.tbank) {
      draft.cases.tbank.gallery = clone(reordered);
      writeJSON(DRAFT_KEY, draft);
    }
    const legacy = readJSON('portfolio-project-edits', {});
    if (legacy.tbank) {
      legacy.tbank.gallery = clone(reordered);
      writeJSON('portfolio-project-edits', legacy);
    }
  }

  function persistCases() {
    const data = savedCases();
    writeJSON(CASE_KEY, data);
    const legacy = readJSON('portfolio-project-edits', {});
    Object.entries(data).forEach(([key, value]) => {
      legacy[key] = Object.assign({}, legacy[key], value);
    });
    writeJSON('portfolio-project-edits', legacy);
  }

  function renderGallery() {
    const project = projects[caseKey];
    gallerySelect.value = caseKey;
    galleryList.innerHTML = '';
    if (!project) return;
    const gallery = project.gallery || [];
    gallery.forEach((src, index) => {
      const row = document.createElement('div');
      row.className = 'admin-gallery-item';
      row.draggable = true;
      row.dataset.galleryIndex = index;
      const bytes = assetBytes(src);
      const heavy = bytes != null && bytes > 1.5 * 1024 * 1024;
      const isHeavyGif = /\.gif(?:$|\?)/i.test(src || '') && bytes != null && bytes > 3 * 1024 * 1024;
      const isVideo = /\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(src || '');
      row.dataset.assetIssue = heavy || isHeavyGif ? 'warning' : '';
      row.innerHTML = `
        <span title="Перетащить">::</span>
        ${src ? (isVideo
          ? `<video class="admin-gallery-thumb" src="${escapeHtml(src)}" muted playsinline preload="metadata"></video>`
          : `<img class="admin-gallery-thumb" src="${escapeHtml(src)}" alt="">`)
          : '<div class="admin-gallery-thumb" style="background:#333"></div>'}
        <div class="admin-gallery-meta"><strong>${escapeHtml(fileName(src))}</strong><span class="${heavy || isHeavyGif ? 'warning' : ''}">${formatBytes(bytes)} · проверка...</span><br><label><input type="radio" name="admin-cover" ${project.cover === src || (!project.cover && index === 0) ? 'checked' : ''}> обложка</label></div>
        <button type="button" class="admin-layer-action" title="Удалить">x</button>`;
      const media = row.querySelector('img, video');
      if (media) {
        const onReady = () => {
          const width = isVideo ? media.videoWidth : media.naturalWidth;
          const height = isVideo ? media.videoHeight : media.naturalHeight;
          const lowResolution = width < 1200;
          const warnings = [];
          if (lowResolution) warnings.push('низкое разрешение');
          if (heavy) warnings.push('тяжёлый файл');
          if (isHeavyGif) warnings.push('тяжёлый GIF');
          row.dataset.assetIssue = warnings.length ? 'warning' : '';
          const meta = `${formatBytes(bytes)} · ${width} x ${height}${warnings.length ? ` · ${warnings.join(', ')}` : ''}`;
          const label = row.querySelector('.admin-gallery-meta span');
          label.textContent = project.cover === src ? `Обложка · ${meta}` : meta;
          label.className = warnings.length ? 'warning' : '';
          updateAssetAudit();
        };
        media.addEventListener(isVideo ? 'loadedmetadata' : 'load', onReady);
        media.addEventListener('error', () => {
          row.dataset.assetIssue = 'error';
          const label = row.querySelector('.admin-gallery-meta span');
          label.textContent = 'Битый путь или файл недоступен';
          label.className = 'error';
          updateAssetAudit();
        });
        media.addEventListener('click', () => openAssetPreview(src, media, isVideo));
      }
      row.querySelector('input[type="radio"]').addEventListener('change', () => {
        project.cover = src;
        const canvasImage = document.querySelector(`[data-project="${CSS.escape(caseKey)}"] img`);
        if (canvasImage && src) canvasImage.src = src;
        persistCases();
        renderGallery();
        scheduleSave('Обложка проекта');
      });
      row.querySelector('button').addEventListener('click', () => {
        project.gallery.splice(index, 1);
        if (project.cover === src) project.cover = project.gallery[0] || null;
        persistCases();
        renderGallery();
        if (window.__currentOpenProject === caseKey && window.openDetail) window.openDetail(caseKey);
        scheduleSave('Удаление из галереи');
      });
      row.addEventListener('dragstart', event => {
        galleryDragIndex = index;
        event.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', event => {
        event.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', event => {
        event.preventDefault();
        row.classList.remove('drag-over');
        if (galleryDragIndex == null || galleryDragIndex === index) return;
        const moved = project.gallery.splice(galleryDragIndex, 1)[0];
        project.gallery.splice(index, 0, moved);
        galleryDragIndex = null;
        persistCases();
        renderGallery();
        if (window.__currentOpenProject === caseKey && window.openDetail) window.openDetail(caseKey);
        scheduleSave('Порядок галереи');
      });
      galleryList.appendChild(row);
    });
    updateAssetAudit();
  }

  function updateAssetAudit() {
    const status = document.getElementById('adminAssetAudit');
    const rows = Array.from(galleryList.querySelectorAll('.admin-gallery-item'));
    const errors = rows.filter(row => row.dataset.assetIssue === 'error').length;
    const warnings = rows.filter(row => row.dataset.assetIssue === 'warning').length;
    const totalBytes = (projects[caseKey]?.gallery || []).reduce((sum, src) => sum + (assetBytes(src) || 0), 0);
    status.textContent = errors
      ? `Ошибки: ${errors}, предупреждения: ${warnings}, общий вес: ${formatBytes(totalBytes)}`
      : `Предупреждения: ${warnings}, общий вес: ${formatBytes(totalBytes)}`;
    status.classList.toggle('warning', errors > 0 || warnings > 0);
  }

  function openAssetPreview(src, sourceMedia, isVideo) {
    if (!src) return;
    const image = preview.querySelector('img');
    const video = preview.querySelector('video');
    image.hidden = isVideo;
    video.hidden = !isVideo;
    if (isVideo) {
      video.src = src;
      video.currentTime = 0;
      video.play().catch(() => {});
    } else {
      video.pause();
      image.src = src;
    }
    const width = isVideo ? sourceMedia.videoWidth : sourceMedia.naturalWidth;
    const height = isVideo ? sourceMedia.videoHeight : sourceMedia.naturalHeight;
    preview.querySelector('.admin-asset-preview-meta').textContent = `${fileName(src)} - ${width} x ${height}px`;
    preview.classList.add('open');
  }

  function buildSnapshot(label) {
    if (viewMode === 'desktop') responsive.desktop = capturePositions();
    else responsive[viewMode] = capturePositions();
    return {
      label: label || 'Версия',
      time: Date.now(),
      state: viewMode === 'desktop' ? api.captureState() : (responsive.desktopState || api.captureState()),
      responsive: clone(responsive),
      layers: clone(layerMeta),
      cases: savedCases(),
      customObjects: serializeCustomObjects()
    };
  }

  function snapshotSignature(snapshot) {
    const comparable = clone(snapshot);
    delete comparable.label;
    delete comparable.time;
    return JSON.stringify(comparable);
  }

  function saveNow(label, forceVersion) {
    clearTimeout(saveTimer);
    const snapshot = buildSnapshot(label);
    writeJSON(DRAFT_KEY, snapshot);
    writeJSON(RESPONSIVE_KEY, responsive);
    writeJSON(LAYER_KEY, layerMeta);
    persistCases();
    const history = readJSON(HISTORY_KEY, []);
    const changed = !history.length || snapshotSignature(history[0]) !== snapshotSignature(snapshot);
    if ((changed && forceVersion !== false) || forceVersion === true) {
      history.unshift(snapshot);
      writeJSON(HISTORY_KEY, history.slice(0, MAX_HISTORY));
    }
    dirty = false;
    saveState.textContent = 'Сохранено';
    saveState.classList.remove('dirty');
    updatePublicationState(snapshot);
    renderHistory();
  }

  function scheduleSave(label) {
    dirty = true;
    saveState.textContent = 'Изменено';
    saveState.classList.add('dirty');
    publishState.textContent = 'Черновик';
    publishState.classList.remove('published');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(label, true), 700);
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    if (viewMode !== 'desktop') switchView('desktop');
    applyCustomObjects(snapshot.customObjects || []);
    api.restoreState(snapshot.state);
    responsive = clone(snapshot.responsive || { desktop: {}, tablet: {}, mobile: {} });
    layerMeta = clone(snapshot.layers || {});
    applyCases(snapshot.cases || {});
    applyLayerMeta();
    renderAll();
    saveNow(`Возврат: ${snapshot.label}`, true);
  }

  function updatePublicationState(snapshot) {
    const current = snapshot || buildSnapshot('Статус');
    const isPublished = publishedSignature && snapshotSignature(current) === publishedSignature;
    publishState.textContent = isPublished ? 'Опубликовано' : 'Черновик';
    publishState.classList.toggle('published', Boolean(isPublished));
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function runPreflight(render) {
    const issues = [];
    Object.entries(projects).forEach(([key, project]) => {
      if (!String(project.title || '').trim()) issues.push({ level: 'error', text: `${key}: нет названия` });
      if (!String(project.desc || '').trim()) issues.push({ level: 'warning', text: `${project.title || key}: нет описания` });
      if (!(project.gallery || []).length) issues.push({ level: 'warning', text: `${project.title || key}: пустая галерея` });
      if ((project.gallery || []).length && !project.cover) issues.push({ level: 'warning', text: `${project.title || key}: обложкой будет первое изображение` });
      (project.gallery || []).forEach(src => {
        if (!src) return;
        const remote = /^(data:|https?:)/i.test(src);
        const path = String(src).replace(/^\.\//, '').split('?')[0];
        if (!remote && !window.__PORTFOLIO_ASSET_SIZES__?.[decodeURIComponent(path)]) {
          issues.push({ level: 'error', text: `${project.title || key}: файл не найден — ${fileName(src)}` });
        }
        const bytes = assetBytes(src);
        if (bytes != null && bytes > 1.5 * 1024 * 1024) {
          issues.push({ level: 'warning', text: `${fileName(src)}: ${formatBytes(bytes)}` });
        }
      });
    });
    const ids = api.getElements().map(api.getElementId);
    ids.filter((id, index) => ids.indexOf(id) !== index).forEach(id => {
      if (!issues.some(issue => issue.text.includes(id))) issues.push({ level: 'error', text: `Повторяется ID слоя: ${id}` });
    });
    ['tablet', 'mobile'].forEach(mode => {
      if (!responsive[mode] || !Object.keys(responsive[mode]).length) {
        issues.push({ level: 'warning', text: `${mode}: позиции ещё не сохранялись отдельно` });
      }
    });
    if (render !== false) {
      const container = document.getElementById('adminPreflightList');
      container.innerHTML = '';
      if (!issues.length) {
        container.innerHTML = '<div class="admin-preflight-item ok">Всё готово к публикации</div>';
      } else {
        issues.forEach(issue => {
          const row = document.createElement('div');
          row.className = `admin-preflight-item ${issue.level}`;
          row.textContent = issue.text;
          container.appendChild(row);
        });
      }
    }
    return {
      issues,
      errors: issues.filter(issue => issue.level === 'error'),
      warnings: issues.filter(issue => issue.level === 'warning')
    };
  }

  async function publishSite() {
    const preflight = runPreflight(true);
    if (preflight.errors.length) {
      saveState.textContent = `Ошибок: ${preflight.errors.length}`;
      saveState.classList.add('dirty');
      return;
    }
    saveNow('Публикация', true);
    const snapshot = buildSnapshot('Опубликовано');
    const source = `window.__PORTFOLIO_PUBLISHED__ = ${JSON.stringify(snapshot, null, 2)};\n`;
    try {
      saveState.textContent = 'Публикую...';
      const result = await helperRequest('/publish', {
        source,
        message: 'Update portfolio from admin'
      }, 120000);
      publishedSignature = snapshotSignature(snapshot);
      writeJSON(PUBLISHED_KEY, publishedSignature);
      publishState.textContent = 'Опубликовано';
      publishState.classList.add('published');
      saveState.textContent = `GitHub: ${result.branch}`;
      return;
    } catch (error) {
      saveState.textContent = 'Локальное сохранение';
    }
    let savedDirectly = false;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'portfolio-published.js',
          types: [{ description: 'Portfolio publish data', accept: { 'text/javascript': ['.js'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(source);
        await writable.close();
        savedDirectly = true;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    if (!savedDirectly) downloadFile('portfolio-published.js', source, 'text/javascript');
    publishedSignature = snapshotSignature(snapshot);
    writeJSON(PUBLISHED_KEY, publishedSignature);
    publishState.textContent = 'Опубликовано';
    publishState.classList.add('published');
    saveState.textContent = savedDirectly ? 'Файл обновлён' : 'Файл скачан';
  }

  function exportAll() {
    const snapshot = buildSnapshot('Полный экспорт');
    downloadFile(`portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), 'application/json');
  }

  function importAll(file) {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const snapshot = JSON.parse(reader.result);
        if (!snapshot || !snapshot.state || !snapshot.cases) throw new Error('invalid');
        restoreSnapshot(snapshot);
        saveState.textContent = 'Импортировано';
      } catch (error) {
        saveState.textContent = 'Ошибка JSON';
        saveState.classList.add('dirty');
      }
    });
    reader.readAsText(file);
  }

  function renderHistory() {
    const container = document.getElementById('adminHistoryList');
    const history = readJSON(HISTORY_KEY, []);
    container.innerHTML = '';
    history.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'admin-history-item';
      const date = new Date(item.time);
      row.innerHTML = `<span><strong>${escapeHtml(item.label || 'Версия')}</strong><br>${date.toLocaleString('ru-RU')}</span><button type="button" class="admin-layer-action" title="Восстановить">↶</button>`;
      row.querySelector('button').addEventListener('click', () => restoreSnapshot(history[index]));
      container.appendChild(row);
    });
    if (!history.length) container.textContent = 'Версий пока нет';
  }

  function renderAll() {
    renderProjectSelects();
    renderLayers();
    renderCaseEditor();
    renderGallery();
    renderHistory();
    renderTrash();
    renderMiniMap();
  }

  workbench.querySelectorAll('[data-admin-tab]').forEach(button => {
    button.addEventListener('click', () => {
      workbench.querySelectorAll('[data-admin-tab]').forEach(item => item.classList.toggle('active', item === button));
      workbench.querySelectorAll('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === button.dataset.adminTab));
    });
  });
  workbench.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.adminView)));
  workbench.querySelectorAll('[data-align]').forEach(button => button.addEventListener('click', () => alignSelection(button.dataset.align)));
  minimap.addEventListener('click', event => {
    if (!minimapTransform || viewMode !== 'desktop') return;
    const rect = minimap.getBoundingClientRect();
    const pixelX = (event.clientX - rect.left) * minimap.width / rect.width;
    const pixelY = (event.clientY - rect.top) * minimap.height / rect.height;
    const worldX = minimapTransform.minX + (pixelX - minimapTransform.offsetX) / minimapTransform.mapScale;
    const worldY = minimapTransform.minY + (pixelY - minimapTransform.offsetY) / minimapTransform.mapScale;
    const canvas = api.getCanvas();
    api.setPan(
      canvas.viewport.clientWidth / 2 - worldX * canvas.scale,
      canvas.viewport.clientHeight / 2 - worldY * canvas.scale
    );
    renderMiniMap();
  });
  document.getElementById('adminLayerSearch').addEventListener('input', renderLayers);
  document.getElementById('adminLayerType').addEventListener('change', renderLayers);
  document.getElementById('adminLasso').addEventListener('click', event => {
    lassoMode = !lassoMode;
    document.body.classList.toggle('admin-lasso-mode', lassoMode);
    event.currentTarget.textContent = lassoMode ? 'Рамка включена' : 'Рамка выделения';
    event.currentTarget.style.background = lassoMode ? '#00c8ff' : '';
    event.currentTarget.style.color = lassoMode ? '#071014' : '';
  });
  document.getElementById('adminDeleteSelected').addEventListener('click', moveSelectionToTrash);
  window.addEventListener('portfolio-admin-selection', syncLayerSelection);
  window.addEventListener('portfolio-admin-change', event => {
    hideGuides();
    checkMobileBounds();
    renderMiniMap();
    scheduleSave(event.detail?.label || 'Изменение объекта');
  });
  window.addEventListener('mouseup', hideGuides, true);

  caseSelect.addEventListener('change', () => {
    caseKey = caseSelect.value;
    gallerySelect.value = caseKey;
    renderCaseEditor();
    renderGallery();
  });
  gallerySelect.addEventListener('change', () => {
    caseKey = gallerySelect.value;
    caseSelect.value = caseKey;
    renderCaseEditor();
    renderGallery();
  });
  document.getElementById('adminAddAccordion').addEventListener('click', () => {
    const project = projects[caseKey];
    project.accordions = project.accordions || [];
    project.accordions.push({ label: 'Новый раздел', content: '' });
    renderCaseEditor();
    scheduleSave('Новый аккордеон');
  });
  document.getElementById('adminApplyCase').addEventListener('click', collectCaseForm);

  const galleryInput = document.getElementById('adminGalleryInput');
  document.getElementById('adminAddGallery').addEventListener('click', () => galleryInput.click());
  function readFileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result));
      reader.addEventListener('error', reject);
      reader.readAsDataURL(file);
    });
  }

  galleryInput.addEventListener('change', async () => {
    const project = projects[caseKey];
    project.gallery = project.gallery || [];
    const files = Array.from(galleryInput.files || []);
    if (!files.length) return;
    saveState.textContent = 'Оптимизирую файлы...';
    const encoded = await Promise.all(files.map(async file => ({
      name: file.name,
      type: file.type,
      data: await readFileData(file)
    })));
    try {
      const result = await helperRequest('/upload', { project: caseKey, files: encoded }, 120000);
      window.__PORTFOLIO_ASSET_SIZES__ = window.__PORTFOLIO_ASSET_SIZES__ || {};
      result.files.forEach(file => {
        project.gallery.push(file.path);
        window.__PORTFOLIO_ASSET_SIZES__[file.path] = { bytes: file.bytes };
      });
      saveState.textContent = result.files.some(file => file.optimized) ? 'WebP готовы' : 'Файлы сохранены';
    } catch (error) {
      encoded.forEach(file => project.gallery.push(file.data));
      saveState.textContent = 'Сохранено в черновик';
    }
    persistCases();
    renderGallery();
    scheduleSave('Добавление в галерею');
    galleryInput.value = '';
  });
  preview.querySelector('video').addEventListener('click', event => event.stopPropagation());
  preview.addEventListener('click', () => {
    preview.querySelector('video').pause();
    preview.classList.remove('open');
  });
  document.getElementById('adminAuditGallery').addEventListener('click', renderGallery);

  document.getElementById('adminCreateVersion').addEventListener('click', () => saveNow('Ручная версия', true));
  document.getElementById('adminRunPreflight').addEventListener('click', () => runPreflight(true));
  document.getElementById('adminPreviewSite').addEventListener('click', () => {
    if (dirty) saveNow('Предпросмотр', true);
    const previewButton = document.getElementById('editPreviewBtn');
    if (previewButton) previewButton.click();
  });
  document.getElementById('adminPublishSite').addEventListener('click', publishSite);
  document.getElementById('adminExportAll').addEventListener('click', exportAll);
  const importInput = document.getElementById('adminImportInput');
  document.getElementById('adminImportAll').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) importAll(importInput.files[0]);
    importInput.value = '';
  });
  document.getElementById('adminExit').addEventListener('click', () => {
    if (dirty) saveNow('Автосохранение перед выходом', true);
    const exitButton = document.getElementById('editExitBtn');
    if (exitButton) exitButton.click();
  });
  const legacySaveButton = document.getElementById('editSaveBtn');
  if (legacySaveButton) legacySaveButton.addEventListener('click', () => saveNow('Ручное сохранение', true));
  document.getElementById('adminSnap').addEventListener('change', event => { snapEnabled = event.target.checked; hideGuides(); });
  document.getElementById('adminGridSnap').addEventListener('change', event => { gridEnabled = event.target.checked; });
  document.getElementById('adminDevicePreset').addEventListener('change', event => setMobilePreset(event.target.value));
  [
    ['adminCoordX', 'x'], ['adminCoordY', 'y'], ['adminCoordR', 'rotate'],
    ['adminCoordW', 'width'], ['adminCoordH', 'height']
  ].forEach(([id, property]) => {
    document.getElementById(id).addEventListener('change', event => applyCoordinate(property, Number(event.target.value)));
  });
  document.getElementById('adminApplyComponent').addEventListener('click', applyComponentFields);
  document.getElementById('adminZoomOut').addEventListener('click', () => {
    const value = Math.max(30, Number(zoomInput.value) - 10);
    zoomInput.value = value;
    api.setZoom(value / 100);
  });
  document.getElementById('adminZoomIn').addEventListener('click', () => {
    const value = Math.min(200, Number(zoomInput.value) + 10);
    zoomInput.value = value;
    api.setZoom(value / 100);
  });
  zoomInput.addEventListener('input', () => api.setZoom(Number(zoomInput.value) / 100));

  document.addEventListener('keydown', event => {
    if (!api.isActive()) return;
    const target = event.target;
    if (target instanceof Element && (target.matches('input, textarea, select') || target.isContentEditable)) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'c') {
      event.preventDefault();
      copySelection();
    } else if (modifier && key === 'v') {
      event.preventDefault();
      pasteSelection();
    } else if (modifier && key === 'd') {
      event.preventDefault();
      duplicateSelection();
    } else if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      moveSelectionToTrash();
    } else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      nudgeSelection(
        key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0,
        key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
      );
    }
  });

  document.addEventListener('click', event => {
    const generated = event.target.closest('[data-admin-generated="true"]');
    if (!generated || document.body.classList.contains('edit-mode')) return;
    const key = generated.dataset.project;
    if (key && window.openDetail) window.openDetail(key);
  });

  const editObserver = new MutationObserver(() => {
    if (document.body.classList.contains('edit-mode')) {
      const settings = document.getElementById('settingsDropdown');
      if (settings) settings.classList.remove('open');
      applyLayerMeta();
      renderAll();
      const canvas = api.getCanvas();
      zoomInput.value = Math.round(canvas.scale * 100);
    } else if (viewMode !== 'desktop') {
      switchView('desktop');
    } else {
      lassoMode = false;
      document.body.classList.remove('admin-lasso-mode');
      lasso.style.display = 'none';
    }
  });
  editObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('beforeunload', () => { if (dirty) saveNow('Автосохранение', true); });

  const publishedData = window.__PORTFOLIO_PUBLISHED__;
  if (publishedData) {
    applyCustomObjects(publishedData.customObjects || []);
    if (publishedData.state) api.restoreState(publishedData.state);
    if (publishedData.responsive) responsive = clone(publishedData.responsive);
    if (publishedData.layers) layerMeta = clone(publishedData.layers);
    if (publishedData.cases) applyCases(publishedData.cases);
    publishedSignature = snapshotSignature(publishedData);
  }
  const startupDraft = readJSON(DRAFT_KEY, null);
  if (startupDraft) {
    applyCustomObjects(startupDraft.customObjects || []);
    if (startupDraft.state) api.restoreState(startupDraft.state);
    if (startupDraft.responsive) responsive = clone(startupDraft.responsive);
    if (startupDraft.layers) layerMeta = clone(startupDraft.layers);
    if (startupDraft.cases) applyCases(startupDraft.cases);
  }
  applyPositionMap(responsive.desktop || {});
  const layoutPatchKey = 'portfolio-layout-patch-20260831-ozon-tala-v1';
  if (!localStorage.getItem(layoutPatchKey)) {
    const layoutPatch = {
      'card-ozon1': { top: '267.78px', left: '2215.25px', transform: 'rotate(-5.09deg)', translate: '0px' },
      'card-ozon2': { top: '112.28px', left: '2552.75px', transform: 'rotate(5.33deg)', translate: '0px' },
      'badge-ozon': { top: '144.5px', left: '2286.75px', transform: 'rotate(-5.64deg)', translate: 'none' },
      'tag-ozon-1': { top: '750.78px', left: '2695.25px', transform: 'rotate(22.046deg)', translate: 'none' },
      'tag-ozon-2': { top: '753.78px', left: '2757.25px', transform: 'rotate(-6.461deg)', translate: 'none' },
      'card-tala1': { top: '873.78px', left: '1327px', transform: 'rotate(4deg)', translate: '0px' },
      'badge-tala': { top: '829.78px', left: '1783.26px', transform: 'rotate(-3deg)', translate: 'none' },
      'tag-tala-1': { top: '799.43px', left: '1361.76px', transform: 'rotate(-5deg)', translate: 'none' },
      'tag-tala-2': { top: '801.78px', left: '1430.43px', transform: 'rotate(-12.32deg)', translate: 'none' },
      'tag-tala-3': { top: '765px', left: '1408.76px', transform: 'rotate(7deg)', translate: 'none' }
    };
    responsive.desktop = { ...(responsive.desktop || {}), ...layoutPatch };
    applyPositionMap(layoutPatch);
    writeJSON(RESPONSIVE_KEY, responsive);
    const draft = readJSON(DRAFT_KEY, null);
    if (draft) {
      draft.responsive = clone(responsive);
      draft.state = api.captureState();
      writeJSON(DRAFT_KEY, draft);
    }
    localStorage.setItem(layoutPatchKey, '1');
  }
  const homigoPatchKey = 'portfolio-layout-patch-20260831-homigo-tag-v1';
  if (!localStorage.getItem(homigoPatchKey)) {
    const homigoPatch = {
      'card-tbank1': { top: '1301.5px', left: '261.167px', transform: 'rotate(-3deg)', translate: '0px' },
      'card-tbank2': { top: '1542.5px', left: '536.167px', transform: 'rotate(8deg)', translate: '0px' },
      'badge-tbank': { top: '1408.5px', left: '690.167px', transform: 'rotate(-5.5deg)', translate: 'none' },
      'tag-tbank': { top: '1394px', left: '858.167px', transform: 'rotate(9deg)', translate: 'none' }
    };
    responsive.desktop = { ...(responsive.desktop || {}), ...homigoPatch };
    applyPositionMap(homigoPatch);
    writeJSON(RESPONSIVE_KEY, responsive);
    const draft = readJSON(DRAFT_KEY, null);
    if (draft) {
      draft.responsive = clone(responsive);
      draft.state = api.captureState();
      writeJSON(DRAFT_KEY, draft);
    }
    localStorage.setItem(homigoPatchKey, '1');
  }
  const electricPatchKey = 'portfolio-layout-patch-20260831-electric-v1';
  if (!localStorage.getItem(electricPatchKey)) {
    const electricPatch = {
      'card-electric1': { top: '366.5px', left: '380.167px', transform: 'rotate(-4deg)', translate: '0px' },
      'card-electric2': { top: '638.78px', left: '763px', transform: 'rotate(7deg)', translate: '0px' }
    };
    responsive.desktop = { ...(responsive.desktop || {}), ...electricPatch };
    applyPositionMap(electricPatch);
    writeJSON(RESPONSIVE_KEY, responsive);
    const draft = readJSON(DRAFT_KEY, null);
    if (draft) {
      draft.responsive = clone(responsive);
      draft.state = api.captureState();
      writeJSON(DRAFT_KEY, draft);
    }
    localStorage.setItem(electricPatchKey, '1');
  }
  const backup3PatchKey = 'portfolio-layout-patch-20260831-backup3-v1';
  if (!localStorage.getItem(backup3PatchKey)) {
    const backup3Patch = {
      'card-redis1': { top: '1130px', left: '2372.62px', transform: 'rotate(-3.66deg)', translate: '0px' },
      'badge-redis': { top: '1083.5px', left: '2316.75px', transform: 'rotate(-9.042deg)', translate: 'none' },
      'tag-redis-1': { top: '1219.89px', left: '2302.75px', transform: 'rotate(-18.52deg)', translate: 'none' },
      'tag-redis-2': { top: '1071px', left: '2542.53px', transform: 'rotate(3deg)', translate: 'none' },
      'card-tala1': { top: '1065px', left: '1300.74px', transform: 'rotate(4deg)', translate: '0px' },
      'badge-tala': { top: '1021px', left: '1757px', transform: 'rotate(-3deg)', translate: 'none' },
      'tag-tala-1': { top: '990.65px', left: '1344.57px', transform: 'rotate(-5deg)', translate: 'none' },
      'tag-tala-2': { top: '993px', left: '1413.24px', transform: 'rotate(-12.32deg)', translate: 'none' },
      'tag-tala-3': { top: '956.22px', left: '1391.57px', transform: 'rotate(7deg)', translate: 'none' },
      'card-kalendar1': { top: '1742.5px', left: '1344.57px', transform: 'rotate(5deg)', translate: '0px' },
      'card-kalendar2': { top: '1989px', left: '1632.57px', transform: 'rotate(-7deg)', translate: '0px' },
      'badge-kalendar': { top: '1907px', left: '1815.57px', transform: 'rotate(3.7deg)', translate: 'none' },
      'tag-kalendar': { top: '1887.5px', left: '1976.57px', transform: 'rotate(-10deg)', translate: 'none' },
      'card-ui1': { top: '1779.25px', left: '2367.75px', transform: 'rotate(-4deg)', translate: '0px' },
      'card-ui2': { top: '1909.25px', left: '2777.75px', transform: 'rotate(7deg)', translate: '0px' },
      'badge-ui': { top: '1700.5px', left: '2683.75px', transform: 'rotate(3deg)', translate: 'none' },
      'tag-ui': { top: '1828.5px', left: '2887.62px', transform: 'rotate(-8deg)', translate: 'none' }
    };
    responsive.desktop = { ...(responsive.desktop || {}), ...backup3Patch };
    applyPositionMap(backup3Patch);
    writeJSON(RESPONSIVE_KEY, responsive);
    const draft = readJSON(DRAFT_KEY, null);
    if (draft) {
      draft.responsive = clone(responsive);
      draft.state = api.captureState();
      writeJSON(DRAFT_KEY, draft);
    }
    localStorage.setItem(backup3PatchKey, '1');
  }
  const polishPatchKey = 'portfolio-layout-patch-20260831-polish-v1';
  if (!localStorage.getItem(polishPatchKey)) {
    const polishPatch = {
      'tag-tala-1': { top: '986px', left: '1360px', transform: 'rotate(-5deg)', translate: 'none' },
      'tag-tala-2': { top: '988px', left: '1418px', transform: 'rotate(-12.32deg)', translate: 'none' },
      'tag-tala-3': { top: '963px', left: '1395px', transform: 'rotate(7deg)', translate: 'none' }
    };
    responsive.desktop = { ...(responsive.desktop || {}), ...polishPatch };
    applyPositionMap(polishPatch);
    writeJSON(RESPONSIVE_KEY, responsive);
    const draft = readJSON(DRAFT_KEY, null);
    if (draft) {
      draft.responsive = clone(responsive);
      draft.state = api.captureState();
      writeJSON(DRAFT_KEY, draft);
    }
    localStorage.setItem(polishPatchKey, '1');
  }
  applyCases(readJSON(CASE_KEY, {}));
  pinOzonGalleryAdditions();
  appendUiConceptAdditions();
  appendHomigoGalleryAdditions();
  const ozonProductText = '— Участвовала в доработке продуктовых интерфейсов и отдельных фич\n\n— Проводила анализ и улучшение пользовательского опыта через гипотезы и визуальные решения\n\n— Концептила новый продукт под NDA и передавала решения доменным командам для дальнейшей проработки';
  if (projects.ozon?.accordions?.[1]) projects.ozon.accordions[1].content = ozonProductText;
  const polishedCases = readJSON(CASE_KEY, {});
  if (polishedCases.ozon?.accordions?.[1]) {
    polishedCases.ozon.accordions[1].content = ozonProductText;
    writeJSON(CASE_KEY, polishedCases);
  }
  const polishedDraft = readJSON(DRAFT_KEY, null);
  if (polishedDraft?.cases?.ozon?.accordions?.[1]) {
    polishedDraft.cases.ozon.accordions[1].content = ozonProductText;
    writeJSON(DRAFT_KEY, polishedDraft);
  }
  applyLayerMeta();
  setMobilePreset(document.getElementById('adminDevicePreset').value);
  renderAll();
  if (!readJSON(HISTORY_KEY, []).length) saveNow('Исходное состояние', true);
  else updatePublicationState();
  window.__adminWorkbench = { renderAll, saveNow, switchView };
})();
