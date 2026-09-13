import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
import { PDFDocument, degrees } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/+esm';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const HISTORY_LIMIT = 100;

const state = {
  sources: new Map(),
  pages: [],
  selected: new Set(),
  sourceOrder: [],
  uploadOrder: [],
  expandedSources: new Set(),
  nextSourceId: 1,
  pageSortable: null,
  sourceSortable: null,
  undoStack: [],
  redoStack: [],
  lastSelectedPageId: null,
  draggingSourceId: null,
  sourceDropIndex: null,
  thumbnailObserver: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'),
  dropZone: $('dropZone'),
  workspace: $('workspace'),
  splitSection: $('splitSection'),
  sourceSection: $('sourceSection'),
  sourceList: $('sourceList'),
  pageGrid: $('pageGrid'),
  statusText: $('statusText'),
  selectionText: $('selectionText'),
  pageCardTemplate: $('pageCardTemplate'),
  sourceCardTemplate: $('sourceCardTemplate'),
  toast: $('toast'),
  undoBtn: $('undoBtn'),
  redoBtn: $('redoBtn'),
  selectAllBtn: $('selectAllBtn'),
  clearSelectionBtn: $('clearSelectionBtn'),
  rotateLeftBtn: $('rotateLeftBtn'),
  rotateRightBtn: $('rotateRightBtn'),
  deleteBtn: $('deleteBtn'),
  resetArrangementBtn: $('resetArrangementBtn'),
  clearProjectBtn: $('clearProjectBtn'),
  downloadArrangedBtn: $('downloadArrangedBtn'),
  extractSelectedBtn: $('extractSelectedBtn'),
  splitSelectedBtn: $('splitSelectedBtn'),
  rangeInput: $('rangeInput'),
  splitRangesBtn: $('splitRangesBtn'),
  goToPageInput: $('goToPageInput'),
  goToPageBtn: $('goToPageBtn'),
  moveModeSelect: $('moveModeSelect'),
  moveTargetInput: $('moveTargetInput'),
  moveSelectedBtn: $('moveSelectedBtn'),
  filenameModal: $('filenameModal'),
  filenameModalTitle: $('filenameModalTitle'),
  filenameModalDescription: $('filenameModalDescription'),
  filenameInput: $('filenameInput'),
  filenameExtension: $('filenameExtension'),
  filenameHint: $('filenameHint'),
  filenameCancelBtn: $('filenameCancelBtn'),
  filenameConfirmBtn: $('filenameConfirmBtn'),
};

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function clonePages(pages) {
  return pages.map((p) => ({ ...p }));
}

function snapshotState() {
  return {
    pages: clonePages(state.pages),
    sourceOrder: [...state.sourceOrder],
  };
}

function restoreSnapshot(snapshot) {
  state.pages = clonePages(snapshot.pages);
  state.sourceOrder = [...snapshot.sourceOrder];
  const pageIds = new Set(state.pages.map((p) => p.id));
  state.selected = new Set([...state.selected].filter((id) => pageIds.has(id)));
  if (state.lastSelectedPageId && !pageIds.has(state.lastSelectedPageId)) state.lastSelectedPageId = null;
  renderAll();
}

function recordHistory() {
  state.undoStack.push(snapshotState());
  if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
  state.redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshotState());
  const previous = state.undoStack.pop();
  restoreSnapshot(previous);
  updateHistoryButtons();
}

function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshotState());
  const next = state.redoStack.pop();
  restoreSnapshot(next);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  els.undoBtn.disabled = state.undoStack.length === 0;
  els.redoBtn.disabled = state.redoStack.length === 0;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

function safeBaseName(name) {
  return name
    .replace(/\.(pdf|zip)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim() || 'document';
}

function suggestedSourceName(suffix) {
  const firstSourceId = state.sourceOrder[0];
  const firstSource = firstSourceId ? state.sources.get(firstSourceId) : null;
  const base = firstSource ? safeBaseName(firstSource.fileName) : 'document';
  return `${base}-${suffix}`;
}

function askForFilename({ title, description, defaultName, extension }) {
  return new Promise((resolve) => {
    const cleanExtension = extension.startsWith('.') ? extension : `.${extension}`;
    let settled = false;

    els.filenameModalTitle.textContent = title;
    els.filenameModalDescription.textContent = description;
    els.filenameInput.value = safeBaseName(defaultName);
    els.filenameExtension.textContent = cleanExtension;
    els.filenameHint.textContent = `The ${cleanExtension} extension will be added automatically.`;
    els.filenameModal.classList.remove('hidden');

    const cleanup = () => {
      els.filenameModal.classList.add('hidden');
      els.filenameConfirmBtn.removeEventListener('click', confirm);
      els.filenameCancelBtn.removeEventListener('click', cancel);
      els.filenameModal.removeEventListener('click', backdropCancel);
      document.removeEventListener('keydown', keyHandler);
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const confirm = () => {
      const escaped = cleanExtension.replace('.', '\\.');
      const typed = els.filenameInput.value.replace(new RegExp(`${escaped}$`, 'i'), '');
      const base = safeBaseName(typed);
      if (!base) return showToast('Enter a file name.');
      finish(`${base}${cleanExtension}`);
    };

    const cancel = () => finish(null);
    const backdropCancel = (event) => {
      if (event.target === els.filenameModal) cancel();
    };
    const keyHandler = (event) => {
      if (event.key === 'Escape') cancel();
      if (event.key === 'Enter' && document.activeElement === els.filenameInput) confirm();
    };

    els.filenameConfirmBtn.addEventListener('click', confirm);
    els.filenameCancelBtn.addEventListener('click', cancel);
    els.filenameModal.addEventListener('click', backdropCancel);
    document.addEventListener('keydown', keyHandler);

    requestAnimationFrame(() => {
      els.filenameInput.focus();
      els.filenameInput.select();
    });
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function updateSummary() {
  const fileCount = state.sources.size;
  const pageCount = state.pages.length;
  els.statusText.textContent = pageCount
    ? `${fileCount} PDF${fileCount === 1 ? '' : 's'} loaded • ${pageCount} page${pageCount === 1 ? '' : 's'}`
    : fileCount
      ? `${fileCount} PDF${fileCount === 1 ? '' : 's'} loaded • no pages currently included`
      : 'No PDFs loaded.';
  els.selectionText.textContent = `${state.selected.size} selected`;
  els.workspace.classList.toggle('hidden', fileCount === 0);
  els.sourceSection.classList.toggle('hidden', fileCount === 0);
  els.splitSection.classList.toggle('hidden', fileCount === 0);
  els.dropZone.classList.toggle('hidden', fileCount > 0);
  els.goToPageInput.max = Math.max(pageCount, 1);
  els.moveTargetInput.max = Math.max(pageCount, 1);
  updateHistoryButtons();
}

function getCurrentSourcePages(sourceId) {
  return state.pages.filter((p) => p.sourceId === sourceId);
}

function ensureThumbnailObserver() {
  if (state.thumbnailObserver) return state.thumbnailObserver;
  state.thumbnailObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = entry.target;
      observer.unobserve(canvas);
      const sourceId = canvas.dataset.sourceId;
      const pageIndex = Number(canvas.dataset.sourcePageIndex);
      const rotation = Number(canvas.dataset.rotation || 0);
      renderCanvasThumbnail(canvas, sourceId, pageIndex, rotation);
    }
  }, { rootMargin: '500px 0px' });
  return state.thumbnailObserver;
}

function observeCanvas(canvas, sourceId, sourcePageIndex, rotation = 0) {
  canvas.dataset.sourceId = sourceId;
  canvas.dataset.sourcePageIndex = String(sourcePageIndex);
  canvas.dataset.rotation = String(rotation);
  canvas.classList.add('lazy-placeholder');
  ensureThumbnailObserver().observe(canvas);
}

async function renderCanvasThumbnail(canvas, sourceId, sourcePageIndex, rotation = 0) {
  try {
    if (!canvas.isConnected) return;
    const source = state.sources.get(sourceId);
    if (!source) return;
    const page = await source.pdfjsDoc.getPage(sourcePageIndex + 1);
    if (!canvas.isConnected) return;
    const totalRotation = (page.rotate + rotation) % 360;
    const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation });
    const wrap = canvas.parentElement;
    const maxW = Math.max(44, Math.min(260, wrap?.clientWidth ? wrap.clientWidth - 10 : 260));
    const maxH = wrap?.clientHeight ? Math.max(54, wrap.clientHeight - 10) : 330;
    const scale = Math.min(maxW / baseViewport.width, maxH / baseViewport.height, 1.35);
    const viewport = page.getViewport({ scale, rotation: totalRotation });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;
    canvas.classList.remove('lazy-placeholder');
  } catch (err) {
    console.error(err);
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) return showToast('Please choose PDF files.');

  for (const file of files) {
    try {
      const bytes = await file.arrayBuffer();
      const sourceId = `src-${state.nextSourceId++}`;
      const renderBytes = bytes.slice(0);
      const exportBytes = bytes.slice(0);
      const pdfjsDoc = await pdfjsLib.getDocument({ data: renderBytes }).promise;
      const pdfLibDoc = await PDFDocument.load(exportBytes);
      state.sources.set(sourceId, {
        id: sourceId,
        fileName: file.name,
        pdfjsDoc,
        pdfLibDoc,
        pageCount: pdfjsDoc.numPages,
      });
      state.sourceOrder.push(sourceId);
      state.uploadOrder.push(sourceId);

      for (let pageIndex = 0; pageIndex < pdfjsDoc.numPages; pageIndex++) {
        state.pages.push({ id: uid(), sourceId, sourcePageIndex: pageIndex, rotation: 0 });
      }
    } catch (err) {
      console.error(err);
      showToast(`Could not open ${file.name}. It may be encrypted or damaged.`);
    }
  }

  els.fileInput.value = '';
  renderAll();
}

function renderAll() {
  renderSourceList();
  renderPageGrid();
  updateSummary();
}

function renderSourceList() {
  els.sourceList.innerHTML = '';

  for (const sourceId of state.sourceOrder) {
    const source = state.sources.get(sourceId);
    if (!source) continue;
    const node = els.sourceCardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.sourceId = sourceId;
    const includedCount = getCurrentSourcePages(sourceId).length;
    node.querySelector('.source-file-name').textContent = source.fileName;
    node.querySelector('.source-page-count').textContent = `${includedCount} of ${source.pageCount} page${source.pageCount === 1 ? '' : 's'} included`;
    const previewCanvas = node.querySelector('.source-preview canvas');
    observeCanvas(previewCanvas, sourceId, 0, 0);

    const expandBtn = node.querySelector('.source-expand-btn');
    const expanded = node.querySelector('.source-expanded');
    const isExpanded = state.expandedSources.has(sourceId);
    expandBtn.textContent = isExpanded ? 'Collapse' : 'Expand';
    expanded.classList.toggle('hidden', !isExpanded);
    if (isExpanded) renderExpandedSource(sourceId, expanded);

    expandBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.expandedSources.has(sourceId)) state.expandedSources.delete(sourceId);
      else state.expandedSources.add(sourceId);
      renderSourceList();
    });

    node.addEventListener('dragstart', (event) => {
      state.draggingSourceId = sourceId;
      state._sourceOrderBeforeDrag = [...state.sourceOrder];
      state._sourceListDropIndex = null;
      node.classList.add('source-native-drag');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/x-pdf-source', sourceId);
      event.dataTransfer.setData('text/plain', source.fileName);
      document.body.classList.add('dragging-source-pdf');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('source-native-drag');
      clearSourceListDropIndicators();
      cleanupSourceDrag();
      renderSourceList();
    });

    els.sourceList.appendChild(node);
  }
}

function clearSourceListDropIndicators() {
  for (const card of els.sourceList.querySelectorAll('.source-card')) {
    card.classList.remove('source-drop-before', 'source-drop-after');
  }
}

function handleSourceListDragOver(event) {
  if (!state.draggingSourceId) return;
  const target = event.target.closest('.source-card');
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearSourceListDropIndicators();
  const rect = target.getBoundingClientRect();
  const after = event.clientX > rect.left + rect.width / 2;
  target.classList.add(after ? 'source-drop-after' : 'source-drop-before');
  const targetIndex = state.sourceOrder.indexOf(target.dataset.sourceId);
  state._sourceListDropIndex = targetIndex + (after ? 1 : 0);
}

function handleSourceListDrop(event) {
  if (!state.draggingSourceId) return;
  event.preventDefault();
  const sourceId = state.draggingSourceId;
  const oldOrder = state._sourceOrderBeforeDrag || [...state.sourceOrder];
  let insertIndex = state._sourceListDropIndex;
  clearSourceListDropIndicators();
  if (insertIndex == null) return cleanupSourceDrag();

  const without = oldOrder.filter((id) => id !== sourceId);
  const oldIndex = oldOrder.indexOf(sourceId);
  if (oldIndex >= 0 && oldIndex < insertIndex) insertIndex -= 1;
  insertIndex = Math.max(0, Math.min(insertIndex, without.length));
  const newOrder = [...without.slice(0, insertIndex), sourceId, ...without.slice(insertIndex)];
  const changed = newOrder.some((id, i) => id !== state.sourceOrder[i]);
  if (changed) {
    recordHistory();
    state.sourceOrder = newOrder;
    const grouped = [];
    for (const id of state.sourceOrder) grouped.push(...state.pages.filter((p) => p.sourceId === id));
    state.pages = grouped;
  }
  cleanupSourceDrag();
  renderAll();
}
function renderExpandedSource(sourceId, container) {
  const source = state.sources.get(sourceId);
  if (!source) return;
  const currentIndexes = new Set(state.pages.filter((p) => p.sourceId === sourceId).map((p) => p.sourcePageIndex));
  const grid = document.createElement('div');
  grid.className = 'source-thumb-grid';
  for (let i = 0; i < source.pageCount; i++) {
    const item = document.createElement('div');
    item.className = `source-thumb${currentIndexes.has(i) ? '' : ' removed'}`;
    item.title = currentIndexes.has(i) ? `Original page ${i + 1}` : `Original page ${i + 1} — removed from project`;
    const box = document.createElement('div');
    box.className = 'source-thumb-box';
    const canvas = document.createElement('canvas');
    box.appendChild(canvas);
    const label = document.createElement('div');
    label.className = 'source-thumb-label';
    label.textContent = `p. ${i + 1}`;
    item.append(box, label);
    grid.appendChild(item);
    observeCanvas(canvas, sourceId, i, 0);
  }
  container.replaceChildren(grid);
}

function handlePageSelection(pageId, event) {
  const currentIndex = state.pages.findIndex((p) => p.id === pageId);
  if (currentIndex < 0) return;

  if (event.shiftKey && state.lastSelectedPageId) {
    const anchorIndex = state.pages.findIndex((p) => p.id === state.lastSelectedPageId);
    if (anchorIndex >= 0) {
      if (!event.ctrlKey && !event.metaKey) state.selected.clear();
      const [start, end] = anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
      for (let i = start; i <= end; i++) state.selected.add(state.pages[i].id);
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (state.selected.has(pageId)) state.selected.delete(pageId);
    else state.selected.add(pageId);
    state.lastSelectedPageId = pageId;
  } else {
    state.selected.clear();
    state.selected.add(pageId);
    state.lastSelectedPageId = pageId;
  }
  renderSelectionState();
}

function renderSelectionState() {
  for (const node of els.pageGrid.querySelectorAll('.page-card')) {
    node.classList.toggle('selected', state.selected.has(node.dataset.pageId));
  }
  updateSummary();
}

function renderPageGrid() {
  if (state.pageSortable) {
    state.pageSortable.destroy();
    state.pageSortable = null;
  }
  els.pageGrid.innerHTML = '';

  state.pages.forEach((page, i) => {
    const node = els.pageCardTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.pageId = page.id;
    node.classList.toggle('selected', state.selected.has(page.id));
    node.querySelector('.index-badge').textContent = i + 1;

    const source = state.sources.get(page.sourceId);
    node.querySelector('.source-name').textContent = source?.fileName || 'Unknown source';
    node.querySelector('.source-page').textContent = `Original page ${page.sourcePageIndex + 1}${page.rotation ? ` • ${page.rotation}°` : ''}`;

    const selectionHandler = (event) => handlePageSelection(page.id, event);
    node.querySelector('.select-toggle').addEventListener('click', (event) => {
      event.stopPropagation();
      selectionHandler(event);
    });
    node.addEventListener('click', (event) => {
      if (event.target.closest('.mini-actions') || event.target.closest('.select-toggle')) return;
      selectionHandler(event);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectionHandler(event);
      }
    });
    node.querySelector('.mini-rotate-left').addEventListener('click', (event) => {
      event.stopPropagation();
      rotateOne(page.id, -90);
    });
    node.querySelector('.mini-rotate-right').addEventListener('click', (event) => {
      event.stopPropagation();
      rotateOne(page.id, 90);
    });
    node.querySelector('.mini-delete').addEventListener('click', (event) => {
      event.stopPropagation();
      removePages([page.id]);
    });

    const canvas = node.querySelector('canvas');
    observeCanvas(canvas, page.sourceId, page.sourcePageIndex, page.rotation);
    els.pageGrid.appendChild(node);
  });

  state.pageSortable = new Sortable(els.pageGrid, {
    animation: 160,
    draggable: '.page-card',
    ghostClass: 'sortable-ghost',
    dragClass: 'sortable-drag',
    scroll: true,
    bubbleScroll: true,
    scrollSensitivity: 110,
    scrollSpeed: 18,
    onStart: (evt) => {
      if (state.draggingSourceId) return;
      const dragId = evt.item.dataset.pageId;
      state._pageDragBefore = clonePages(state.pages);
      state._pageDragSelected = state.selected.has(dragId) && state.selected.size > 1
        ? state.pages.filter((p) => state.selected.has(p.id)).map((p) => p.id)
        : [dragId];
      for (const id of state._pageDragSelected) {
        els.pageGrid.querySelector(`[data-page-id="${CSS.escape(id)}"]`)?.classList.add('drag-group-member');
      }
    },
    onEnd: (evt) => {
      if (!state._pageDragBefore) return;
      const before = state._pageDragBefore;
      const groupIds = state._pageDragSelected || [evt.item.dataset.pageId];
      const groupSet = new Set(groupIds);
      const group = before.filter((p) => groupSet.has(p.id));
      const remaining = before.filter((p) => !groupSet.has(p.id));
      const domOrder = [...els.pageGrid.querySelectorAll('.page-card')].map((el) => el.dataset.pageId);
      const draggedId = evt.item.dataset.pageId;
      const dragDomIndex = domOrder.indexOf(draggedId);
      let nextNonGroup = null;
      for (let i = dragDomIndex + 1; i < domOrder.length; i++) {
        if (!groupSet.has(domOrder[i])) { nextNonGroup = domOrder[i]; break; }
      }
      let insertIndex;
      if (nextNonGroup) {
        insertIndex = remaining.findIndex((p) => p.id === nextNonGroup);
      } else {
        let prevNonGroup = null;
        for (let i = dragDomIndex - 1; i >= 0; i--) {
          if (!groupSet.has(domOrder[i])) { prevNonGroup = domOrder[i]; break; }
        }
        insertIndex = prevNonGroup ? remaining.findIndex((p) => p.id === prevNonGroup) + 1 : 0;
      }
      const reordered = [...remaining.slice(0, insertIndex), ...group, ...remaining.slice(insertIndex)];
      const changed = reordered.some((p, i) => p.id !== before[i]?.id);
      state._pageDragBefore = null;
      state._pageDragSelected = null;
      if (!changed) return renderPageGrid();
      state.undoStack.push({ pages: before, sourceOrder: [...state.sourceOrder] });
      if (state.undoStack.length > HISTORY_LIMIT) state.undoStack.shift();
      state.redoStack = [];
      state.pages = reordered;
      renderPageGrid();
      updateSummary();
    },
  });

  updateSummary();
}

function rotateOne(pageId, delta) {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return;
  recordHistory();
  page.rotation = (page.rotation + delta + 360) % 360;
  renderPageGrid();
}

function rotateSelected(delta) {
  if (!state.selected.size) return showToast('Select at least one page first.');
  recordHistory();
  for (const page of state.pages) {
    if (state.selected.has(page.id)) page.rotation = (page.rotation + delta + 360) % 360;
  }
  renderPageGrid();
}

function removePages(ids) {
  const remove = new Set(ids);
  if (!state.pages.some((p) => remove.has(p.id))) return;
  recordHistory();
  state.pages = state.pages.filter((p) => !remove.has(p.id));
  for (const id of ids) state.selected.delete(id);
  if (state.lastSelectedPageId && remove.has(state.lastSelectedPageId)) state.lastSelectedPageId = null;
  renderAll();
}

function selectedPagesInOrder() {
  return state.pages.filter((p) => state.selected.has(p.id));
}

function moveSelectedByNumber() {
  const selected = selectedPagesInOrder();
  if (!selected.length) return showToast('Select one or more pages first.');
  const targetNum = Number(els.moveTargetInput.value);
  if (!Number.isInteger(targetNum) || targetNum < 1 || targetNum > state.pages.length) {
    return showToast(`Enter a target page from 1 to ${state.pages.length}.`);
  }
  const target = state.pages[targetNum - 1];
  if (state.selected.has(target.id)) return showToast('Choose an unselected target page.');

  recordHistory();
  const selectedSet = new Set(selected.map((p) => p.id));
  const remaining = state.pages.filter((p) => !selectedSet.has(p.id));
  let targetIndex = remaining.findIndex((p) => p.id === target.id);
  if (els.moveModeSelect.value === 'after') targetIndex += 1;
  state.pages = [...remaining.slice(0, targetIndex), ...selected, ...remaining.slice(targetIndex)];
  renderPageGrid();
  const firstMovedIndex = state.pages.findIndex((p) => p.id === selected[0].id) + 1;
  showToast(`Moved ${selected.length} page${selected.length === 1 ? '' : 's'} to page ${firstMovedIndex}.`);
}

function goToPage() {
  const num = Number(els.goToPageInput.value);
  if (!Number.isInteger(num) || num < 1 || num > state.pages.length) {
    return showToast(`Enter a page from 1 to ${state.pages.length}.`);
  }
  const id = state.pages[num - 1].id;
  const node = els.pageGrid.querySelector(`[data-page-id="${CSS.escape(id)}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('page-jump-highlight');
  requestAnimationFrame(() => node.classList.add('page-jump-highlight'));
  setTimeout(() => node.classList.remove('page-jump-highlight'), 1500);
}

function resetArrangement() {
  if (!state.sources.size) return;
  recordHistory();
  state.sourceOrder = state.uploadOrder.filter((id) => state.sources.has(id));
  const included = new Map();
  for (const page of state.pages) included.set(`${page.sourceId}:${page.sourcePageIndex}`, page);
  const reset = [];
  for (const sourceId of state.sourceOrder) {
    const source = state.sources.get(sourceId);
    for (let i = 0; i < source.pageCount; i++) {
      const page = included.get(`${sourceId}:${i}`);
      if (page) reset.push(page);
    }
  }
  state.pages = reset;
  state.selected.clear();
  state.lastSelectedPageId = null;
  renderAll();
  showToast('Arrangement reset. Deleted pages remain removed.');
}

function clearProject() {
  if (!state.sources.size) return;
  if (!window.confirm('Clear all PDFs and editing history from this project?')) return;
  state.sources.clear();
  state.pages = [];
  state.selected.clear();
  state.sourceOrder = [];
  state.uploadOrder = [];
  state.expandedSources.clear();
  state.nextSourceId = 1;
  state.undoStack = [];
  state.redoStack = [];
  state.lastSelectedPageId = null;
  els.fileInput.value = '';
  els.rangeInput.value = '';
  els.goToPageInput.value = '';
  els.moveTargetInput.value = '';
  renderAll();
}

function buildInsertionMarker(sourceId) {
  const marker = document.createElement('div');
  marker.className = 'pdf-insertion-marker';
  marker.id = 'pdfInsertionMarker';
  const count = getCurrentSourcePages(sourceId).length;
  marker.innerHTML = `<div><strong>INSERT ${count}-PAGE PDF HERE</strong><span>Release to move the entire PDF as one block</span></div>`;
  return marker;
}

function positionSourceInsertionMarker(index) {
  if (!state.draggingSourceId) return;
  state.sourceDropIndex = Math.max(0, Math.min(index, state.pages.length));
  document.getElementById('pdfInsertionMarker')?.remove();
  const marker = buildInsertionMarker(state.draggingSourceId);
  const cards = [...els.pageGrid.querySelectorAll('.page-card')];
  const beforeCard = cards[state.sourceDropIndex];
  if (beforeCard) els.pageGrid.insertBefore(marker, beforeCard);
  else els.pageGrid.appendChild(marker);
}

function handleSourceGridDragOver(event) {
  if (!state.draggingSourceId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const card = event.target.closest('.page-card');
  if (!card) {
    positionSourceInsertionMarker(state.pages.length);
    autoScrollDuringNativeDrag(event);
    return;
  }
  const cardIndex = [...els.pageGrid.querySelectorAll('.page-card')].indexOf(card);
  const rect = card.getBoundingClientRect();
  const horizontal = event.clientX < rect.left + rect.width / 2;
  positionSourceInsertionMarker(cardIndex + (horizontal ? 0 : 1));
  autoScrollDuringNativeDrag(event);
}

function handleSourceGridDrop(event) {
  if (!state.draggingSourceId) return;
  event.preventDefault();
  const sourceId = state.draggingSourceId;
  const block = state.pages.filter((p) => p.sourceId === sourceId);
  if (!block.length) {
    cleanupSourceDrag();
    return showToast('That PDF has no pages currently included.');
  }
  const rawIndex = state.sourceDropIndex ?? state.pages.length;
  const indexesBefore = state.pages.reduce((count, p, idx) => count + (idx < rawIndex && p.sourceId === sourceId ? 1 : 0), 0);
  const adjustedIndex = Math.max(0, rawIndex - indexesBefore);
  recordHistory();
  const remaining = state.pages.filter((p) => p.sourceId !== sourceId);
  state.pages = [...remaining.slice(0, adjustedIndex), ...block, ...remaining.slice(adjustedIndex)];
  cleanupSourceDrag();
  renderPageGrid();
  showToast(`Moved ${block.length}-page PDF as a block.`);
}

function cleanupSourceDrag() {
  state.draggingSourceId = null;
  state.sourceDropIndex = null;
  document.getElementById('pdfInsertionMarker')?.remove();
  document.body.classList.remove('dragging-source-pdf');
}

function autoScrollDuringNativeDrag(event) {
  const zone = 110;
  const speed = 22;
  if (event.clientY < zone) window.scrollBy(0, -speed);
  else if (window.innerHeight - event.clientY < zone) window.scrollBy(0, speed);
}

async function buildPdf(pageRefs) {
  const out = await PDFDocument.create();
  for (const ref of pageRefs) {
    const source = state.sources.get(ref.sourceId);
    const [copied] = await out.copyPages(source.pdfLibDoc, [ref.sourcePageIndex]);
    if (ref.rotation) {
      const current = copied.getRotation().angle || 0;
      copied.setRotation(degrees((current + ref.rotation) % 360));
    }
    out.addPage(copied);
  }
  return out.save();
}

async function downloadArranged() {
  if (!state.pages.length) return showToast('There are no pages to download.');
  const filename = await askForFilename({
    title: 'Name your arranged PDF',
    description: 'Choose the name for the rearranged PDF you are about to create.',
    defaultName: suggestedSourceName('arranged'),
    extension: '.pdf',
  });
  if (!filename) return;
  const bytes = await buildPdf(state.pages);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
}

async function extractSelected() {
  const refs = selectedPagesInOrder();
  if (!refs.length) return showToast('Select the pages you want to extract.');
  const filename = await askForFilename({
    title: 'Name your extracted PDF',
    description: 'Choose the name for the PDF containing your selected pages.',
    defaultName: suggestedSourceName('selected-pages'),
    extension: '.pdf',
  });
  if (!filename) return;
  const bytes = await buildPdf(refs);
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
}

async function splitSelected() {
  const refs = selectedPagesInOrder();
  if (!refs.length) return showToast('Select the pages you want to split.');
  const filename = await askForFilename({
    title: 'Name your split-page ZIP',
    description: 'Choose the ZIP name. Each selected page will be saved as a separate PDF inside it.',
    defaultName: suggestedSourceName('split-pages'),
    extension: '.zip',
  });
  if (!filename) return;
  const zipBase = safeBaseName(filename);
  const zip = new window.JSZip();
  for (let i = 0; i < refs.length; i++) {
    const bytes = await buildPdf([refs[i]]);
    zip.file(`${zipBase}-page-${String(i + 1).padStart(3, '0')}.pdf`, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, filename);
}

function parseRanges(input, pageCount) {
  const groups = input.split(';').map((s) => s.trim()).filter(Boolean);
  if (!groups.length) throw new Error('Enter at least one range.');
  return groups.map((group) => {
    const nums = [];
    for (const token of group.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^\d+$/.test(token)) nums.push(Number(token));
      else {
        const match = token.match(/^(\d+)\s*-\s*(\d+)$/);
        if (!match) throw new Error(`Invalid range: ${token}`);
        let a = Number(match[1]);
        const b = Number(match[2]);
        const step = a <= b ? 1 : -1;
        for (let n = a; ; n += step) {
          nums.push(n);
          if (n === b) break;
        }
      }
    }
    if (!nums.length) throw new Error(`Empty range group: ${group}`);
    nums.forEach((n) => {
      if (n < 1 || n > pageCount) throw new Error(`Page ${n} is outside 1-${pageCount}.`);
    });
    return nums;
  });
}

async function splitRanges() {
  if (!state.pages.length) return showToast('There are no pages to split.');
  let groups;
  try {
    groups = parseRanges(els.rangeInput.value, state.pages.length);
  } catch (err) {
    return showToast(err.message);
  }
  const filename = await askForFilename({
    title: 'Name your range-split ZIP',
    description: 'Choose the ZIP name. Each range will become a separate PDF inside it.',
    defaultName: suggestedSourceName('split-ranges'),
    extension: '.zip',
  });
  if (!filename) return;
  const zipBase = safeBaseName(filename);
  const zip = new window.JSZip();
  for (let i = 0; i < groups.length; i++) {
    const refs = groups[i].map((n) => state.pages[n - 1]);
    const bytes = await buildPdf(refs);
    zip.file(`${zipBase}-${String(i + 1).padStart(2, '0')}-pages-${groups[i].join('-')}.pdf`, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, filename);
}

els.fileInput.addEventListener('change', (e) => addFiles(e.target.files));
els.undoBtn.addEventListener('click', undo);
els.redoBtn.addEventListener('click', redo);
els.selectAllBtn.addEventListener('click', () => {
  state.pages.forEach((p) => state.selected.add(p.id));
  state.lastSelectedPageId = state.pages.at(-1)?.id || null;
  renderSelectionState();
});
els.clearSelectionBtn.addEventListener('click', () => {
  state.selected.clear();
  state.lastSelectedPageId = null;
  renderSelectionState();
});
els.rotateLeftBtn.addEventListener('click', () => rotateSelected(-90));
els.rotateRightBtn.addEventListener('click', () => rotateSelected(90));
els.deleteBtn.addEventListener('click', () => {
  if (!state.selected.size) return showToast('Select at least one page first.');
  removePages([...state.selected]);
});
els.resetArrangementBtn.addEventListener('click', resetArrangement);
els.clearProjectBtn.addEventListener('click', clearProject);
els.downloadArrangedBtn.addEventListener('click', downloadArranged);
els.extractSelectedBtn.addEventListener('click', extractSelected);
els.splitSelectedBtn.addEventListener('click', splitSelected);
els.splitRangesBtn.addEventListener('click', splitRanges);
els.goToPageBtn.addEventListener('click', goToPage);
els.goToPageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goToPage(); });
els.moveSelectedBtn.addEventListener('click', moveSelectedByNumber);
els.moveTargetInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') moveSelectedByNumber(); });
els.sourceList.addEventListener('dragover', handleSourceListDragOver);
els.sourceList.addEventListener('drop', handleSourceListDrop);
els.pageGrid.addEventListener('dragover', handleSourceGridDragOver);
els.pageGrid.addEventListener('drop', handleSourceGridDrop);

['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
}));
els.dropZone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isTyping) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && event.shiftKey) {
    event.preventDefault();
    redo();
  } else if (key === 'z') {
    event.preventDefault();
    undo();
  } else if (key === 'y') {
    event.preventDefault();
    redo();
  }
});

document.addEventListener('dragover', (event) => {
  if (state.draggingSourceId) autoScrollDuringNativeDrag(event);
});
document.addEventListener('drop', (event) => {
  if (state.draggingSourceId && !event.target.closest('#pageGrid')) cleanupSourceDrag();
});

renderAll();
