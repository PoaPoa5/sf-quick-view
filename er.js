// ==========================================
// ER図ジェネレーター - Full Rewrite
// 設計方針:
//   - ノードはすべて position:absolute で canvas-world 内に配置
//   - SVG線は canvas-world の原点基準 (canvas-world のオフセット座標)
//   - ズーム/パンは canvas-world に CSS transform を適用
//   - ドラッグはノードの left/top を直接更新
// ==========================================

// --- State ---
let allObjects = [];
let nodes = []; // [{id, el, x, y}]
let canvasScale = 1;
let canvasPanX = 0;
let canvasPanY = 0;
let layoutData = null; // { centerLabel, centerName, parents, children }

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['sfInfo'], async (result) => {
        const sfInfo = result.sfInfo;
        if (!sfInfo) {
            document.getElementById('target-org-id').textContent = chrome.i18n.getMessage('statusNotConnected') || 'Not Connected';
            return;
        }
        window.currentSfInfo = sfInfo;
        document.getElementById('target-org-id').textContent = sfInfo.domain;
        await initObjectList();

        const urlParams = new URLSearchParams(window.location.search);
        const targetObj = urlParams.get('obj');
        if (targetObj) {
            document.getElementById('er-object-search').value = targetObj;
            document.getElementById('btn-draw').click();
        }
    });

    setupCanvasInteraction();
    setupZoomControls();
});

function showLoading(show, txt) {
    const el = document.getElementById('loading');
    document.getElementById('loading-text').textContent = txt || chrome.i18n.getMessage('loadingMsg') || 'Loading...';
    el.style.display = show ? 'flex' : 'none';
}

// --- Object List ---
async function initObjectList() {
    const searchInput = document.getElementById('er-object-search');
    const dataList = document.getElementById('er-object-list');
    showLoading(true, chrome.i18n.getMessage('erLoadingObj') || 'Fetching objects...');
    try {
        const data = await sfApiGet('/services/data/v60.0/sobjects');
        allObjects = data.sobjects;
        allObjects.forEach(obj => {
            const opt = document.createElement('option');
            opt.value = obj.name;
            opt.textContent = obj.label;
            dataList.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
        alert(chrome.i18n.getMessage('errorMsg') || 'Initialization error.');
    } finally {
        showLoading(false);
    }

    document.getElementById('btn-draw').addEventListener('click', handleDraw);
}

async function handleDraw() {
    const apiName = document.getElementById('er-object-search').value.trim();
    if (!apiName) return;
    const matched = allObjects.find(o => o.name === apiName);
    if (!matched) {
        alert(chrome.i18n.getMessage('erInvalidObj') || 'Invalid object name.');
        return;
    }
    showLoading(true, chrome.i18n.getMessage('erLoadingRel') || 'Analyzing relationships...');
    try {
        const data = await sfApiGet(`/services/data/v60.0/sobjects/${apiName}/describe`);
        document.getElementById('empty-state').style.display = 'none';

        const parents = [];
        data.fields.forEach(f => {
            if (f.type === 'reference' && f.referenceTo && f.referenceTo.length > 0) {
                f.referenceTo.forEach(ref => {
                    parents.push({
                        id: `${f.name}_${ref}`,
                        fieldLabel: f.label,
                        fieldName: f.name,
                        targetObject: ref,
                        isMasterDetail: (!f.nillable || f.cascadeDelete)
                    });
                });
            }
        });

        const children = [];
        if (data.childRelationships) {
            data.childRelationships.forEach(cr => {
                if (cr.childSObject) {
                    children.push({
                        id: `child_${cr.childSObject}_${cr.field}`,
                        childObject: cr.childSObject,
                        fieldName: cr.field
                    });
                }
            });
        }

        layoutData = { centerLabel: data.label, centerName: data.name, parents, children };
        renderDiagram(layoutData);
    } catch (e) {
        console.error(e);
        alert(chrome.i18n.getMessage('errorMsg') || 'Failed to fetch object information.');
    } finally {
        showLoading(false);
    }
}

// ==========================================
// Layout & Rendering
// ==========================================
const NODE_W = 210;
const NODE_H = 72; // approx
const PARENT_X = 80;
const CENTER_X = 600;
const CHILD_X = 1120;
const START_Y = 60;
const V_GAP = 20;

function renderDiagram(data) {
    // Clear existing nodes
    nodes = [];
    // Remove old node elements (not the SVG)
    const world = document.getElementById('canvas-world');
    world.querySelectorAll('.node').forEach(n => n.remove());
    // Clear SVG lines
    clearLines();

    const { centerLabel, centerName, parents, children } = data;

    // Limit children display
    const displayChildren = children.slice(0, 40);

    // --- Calculate total heights ---
    const parentTotalH = parents.length * (NODE_H + V_GAP);
    const childTotalH = displayChildren.length * (NODE_H + V_GAP);
    const maxH = Math.max(parentTotalH, childTotalH, NODE_H + 80);

    const centerY = maxH / 2;

    // --- Place Center Node ---
    const centerNode = createNodeEl('center', centerLabel, centerName, 'node-center', '');
    placeNode(centerNode, CENTER_X, centerY - NODE_H / 2);

    // --- Place Parent Nodes (Left Column) ---
    const parentStartY = centerY - parentTotalH / 2;
    parents.forEach((p, i) => {
        const y = parentStartY + i * (NODE_H + V_GAP);
        const label = p.isMasterDetail ? (chrome.i18n.getMessage('erMasterDetail') || 'Master-Detail') : (chrome.i18n.getMessage('erLookup') || 'Lookup');
        const cls = p.isMasterDetail ? 'node-parent-md' : 'node-parent-ref';
        const el = createNodeEl(`parent-${i}`, p.targetObject, `API: ${p.fieldName}`, cls, label);
        el.dataset.lineFrom = `parent-${i}`;
        el.dataset.lineTo = 'center';
        el.dataset.lineType = p.isMasterDetail ? 'solid' : 'dashed';
        placeNode(el, PARENT_X, Math.max(START_Y, y));
    });

    // --- Place Child Nodes (Right Column) ---
    const childStartY = centerY - childTotalH / 2;
    displayChildren.forEach((c, i) => {
        const y = childStartY + i * (NODE_H + V_GAP);
        const label = chrome.i18n.getMessage('erChildren') || 'Related List';
        const el = createNodeEl(`child-${i}`, c.childObject, `via: ${c.fieldName}`, 'node-child', label);
        el.dataset.lineFrom = 'center';
        el.dataset.lineTo = `child-${i}`;
        el.dataset.lineType = 'dashed';
        placeNode(el, CHILD_X, Math.max(START_Y, y));
    });

    if (children.length > 40) {
        const lastY = childStartY + 40 * (NODE_H + V_GAP);
        const othersMsg = chrome.i18n.getMessage('erOthers', [String(children.length - 40)]) || `... and ${children.length - 40} others`;
        const moreEl = createNodeEl('child-more', othersMsg, '', 'node-child', '');
        placeNode(moreEl, CHILD_X, Math.max(START_Y, lastY));
    }

    // Draw lines after next paint
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            drawAllLines();
            fitToScreen();
        });
    });
}

function createNodeEl(id, name, api, cls, labelTop) {
    const el = document.createElement('div');
    el.className = `node ${cls}`;
    el.id = `node-${id}`;
    el.dataset.nodeId = id;
    el.innerHTML = `
        ${labelTop ? `<div class="node-label-sm">${labelTop}</div>` : ''}
        <div class="node-name" title="${name}">${name}</div>
        ${api ? `<div class="node-api" title="${api}">${api}</div>` : ''}
    `;
    setupNodeDrag(el);
    document.getElementById('canvas-world').appendChild(el);
    return el;
}

function placeNode(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    nodes.push({ id: el.dataset.nodeId, el, x, y });
}

// ==========================================
// SVG Lines
// ==========================================
function clearLines() {
    const svg = document.getElementById('er-svg');
    svg.querySelectorAll('.er-line, .er-label-bg, .er-label-text').forEach(e => e.remove());
}

function drawAllLines() {
    clearLines();
    const world = document.getElementById('canvas-world');
    world.querySelectorAll('.node[data-line-from]').forEach(el => {
        const fromId = el.dataset.lineFrom;
        const toId = el.dataset.lineTo;
        const type = el.dataset.lineType;

        const fromEl = fromId === 'center' ? document.getElementById('node-center') : document.getElementById(`node-${fromId}`);
        const toEl = toId === 'center' ? document.getElementById('node-center') : document.getElementById(`node-${toId}`);

        if (!fromEl || !toEl) return;

        drawLine(fromEl, toEl, type);
    });
}

function getNodeCenter(el) {
    const x = parseFloat(el.style.left) + el.offsetWidth / 2;
    const y = parseFloat(el.style.top) + el.offsetHeight / 2;
    return { x, y };
}

function drawLine(fromEl, toEl, type) {
    const svg = document.getElementById('er-svg');
    const isSolid = type === 'solid';

    // Use right edge of from, left edge of to (or vice versa based on position)
    const fromX = parseFloat(fromEl.style.left);
    const fromY = parseFloat(fromEl.style.top);
    const fromW = fromEl.offsetWidth;
    const fromH = fromEl.offsetHeight;

    const toX = parseFloat(toEl.style.left);
    const toY = parseFloat(toEl.style.top);
    const toW = toEl.offsetWidth;
    const toH = toEl.offsetHeight;

    // Determine exit/entry points
    let x1, y1, x2, y2;
    if (fromX + fromW <= toX) {
        // from is to the left of to
        x1 = fromX + fromW;
        y1 = fromY + fromH / 2;
        x2 = toX;
        y2 = toY + toH / 2;
    } else {
        // from is to the right of to
        x1 = fromX;
        y1 = fromY + fromH / 2;
        x2 = toX + toW;
        y2 = toY + toH / 2;
    }

    const cx = (x1 + x2) / 2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('er-line');
    path.setAttribute('d', `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', isSolid ? '#6366f1' : '#94a3b8');
    path.setAttribute('stroke-width', isSolid ? '2.5' : '1.5');
    if (!isSolid) path.setAttribute('stroke-dasharray', '6,4');
    path.setAttribute('marker-end', isSolid ? 'url(#arr-solid)' : 'url(#arr-dashed)');

    svg.appendChild(path);
}

// ==========================================
// Node Drag
// ==========================================
function setupNodeDrag(el) {
    let startMouseX, startMouseY, startLeft, startTop;
    let dragging = false;

    el.addEventListener('mousedown', e => {
        e.stopPropagation();
        dragging = true;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startLeft = parseFloat(el.style.left) || 0;
        startTop = parseFloat(el.style.top) || 0;
        el.classList.add('dragging');
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    function onMove(e) {
        if (!dragging) return;
        const dx = (e.clientX - startMouseX) / canvasScale;
        const dy = (e.clientY - startMouseY) / canvasScale;
        el.style.left = (startLeft + dx) + 'px';
        el.style.top = (startTop + dy) + 'px';
        requestAnimationFrame(drawAllLines);
    }

    function onUp() {
        dragging = false;
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    }
}

// ==========================================
// Canvas Pan & Zoom
// ==========================================
function applyCanvasTransform() {
    const world = document.getElementById('canvas-world');
    world.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasScale})`;
    world.style.transformOrigin = '0 0';
    document.getElementById('btn-zoom-label').textContent = Math.round(canvasScale * 100) + '%';
    requestAnimationFrame(drawAllLines);
}

function setupCanvasInteraction() {
    const area = document.getElementById('canvas-area');
    let isPanning = false;
    let startPanX, startPanY;

    // Wheel zoom
    area.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = area.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? 1.06 : 0.94;
        const newScale = Math.max(0.1, Math.min(canvasScale * factor, 4));

        // Zoom centered on mouse position
        canvasPanX = mouseX - (mouseX - canvasPanX) * (newScale / canvasScale);
        canvasPanY = mouseY - (mouseY - canvasPanY) * (newScale / canvasScale);
        canvasScale = newScale;

        applyCanvasTransform();
    }, { passive: false });

    // Pan
    area.addEventListener('mousedown', e => {
        if (e.target.closest('.node')) return;
        isPanning = true;
        startPanX = e.clientX - canvasPanX;
        startPanY = e.clientY - canvasPanY;
        area.classList.add('grabbing');
    });

    window.addEventListener('mousemove', e => {
        if (!isPanning) return;
        canvasPanX = e.clientX - startPanX;
        canvasPanY = e.clientY - startPanY;
        applyCanvasTransform();
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            area.classList.remove('grabbing');
        }
    });
}

function setupZoomControls() {
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
        canvasScale = Math.min(canvasScale * 1.25, 4);
        applyCanvasTransform();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
        canvasScale = Math.max(canvasScale / 1.25, 0.1);
        applyCanvasTransform();
    });
    document.getElementById('btn-fit').addEventListener('click', fitToScreen);
    document.getElementById('btn-reset-layout').addEventListener('click', () => {
        if (layoutData) renderDiagram(layoutData);
    });
}

function fitToScreen() {
    if (nodes.length === 0) return;

    const area = document.getElementById('canvas-area');
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;

    // Find bounding box of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(({ el }) => {
        const x = parseFloat(el.style.left) || 0;
        const y = parseFloat(el.style.top) || 0;
        const w = el.offsetWidth || NODE_W;
        const h = el.offsetHeight || NODE_H;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const padding = 60;

    const scaleX = (areaW - padding * 2) / contentW;
    const scaleY = (areaH - padding * 2) / contentH;
    canvasScale = Math.max(0.1, Math.min(Math.min(scaleX, scaleY), 1));

    // 中央に配置するためのオフセット計算
    const scaledContentW = contentW * canvasScale;
    const scaledContentH = contentH * canvasScale;
    const offsetX = (areaW - scaledContentW) / 2;
    const offsetY = (areaH - scaledContentH) / 2;

    canvasPanX = offsetX - minX * canvasScale;
    canvasPanY = offsetY - minY * canvasScale;

    applyCanvasTransform();
}
