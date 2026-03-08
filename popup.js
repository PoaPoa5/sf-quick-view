let currentSfInfo = null;
let allObjects = [];
let currentFields = [];

document.addEventListener('DOMContentLoaded', async () => {
  console.log('SF Quick Admin 拡張機能がロードされました。');
  const statusText = document.getElementById('status-text');

  try {
    statusText.textContent = '接続中...';
    statusText.className = 'text-xs text-blue-500 font-bold bg-blue-50 px-2 py-1 rounded border border-blue-100';

    const sfInfo = await getSalesforceSession();
    if (sfInfo) {
      statusText.textContent = `接続確認中...`;

      const testResult = await testSalesforceApi(sfInfo);
      if (testResult.success) {
        window.currentSfInfo = sfInfo;
        chrome.storage.local.set({ sfInfo: sfInfo });
        statusText.textContent = `接続済み (${sfInfo.domain})`;
        statusText.className = 'text-[10px] text-green-700 font-bold bg-emerald-50 px-2 py-1 rounded border border-emerald-200';
        console.log('Salesforce API 接続成功');

        // --- 処理の初期化 ---
        setupTabs();
        await initObjectReference();
        initSoqlRunner();
        initErGenerator();

      } else {
        statusText.textContent = `APIエラー: ${testResult.status}`;
        statusText.title = `URL: ${testResult.apiUrl} | MSG: ${testResult.errorMsg}`;
        statusText.className = 'text-[10px] text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-200 cursor-help';
        console.error('API Error Details:', testResult);
      }
    } else {
      statusText.textContent = 'Salesforceの画面を開いてください';
      statusText.className = 'text-[10px] text-slate-500 font-bold bg-slate-100 px-2 py-1 rounded border border-slate-200';
    }
  } catch (err) {
    statusText.textContent = `エラー: ${err.message}`;
    statusText.className = 'text-[10px] text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-200';
    console.error(err);
  }
});

// ==========================================
// タブ切り替え処理
// ==========================================
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all
      tabs.forEach(t => {
        t.classList.remove('text-blue-700', 'border-b-2', 'border-blue-600');
        t.classList.add('text-slate-500');
      });
      contents.forEach(c => c.classList.add('hidden'));

      // Activate selected
      tab.classList.remove('text-slate-500');
      tab.classList.add('text-blue-700', 'border-b-2', 'border-blue-600');
      const targetId = tab.dataset.target;
      document.getElementById(targetId).classList.remove('hidden');
    });
  });
}

// ==========================================
// API & 認証処理
// ==========================================



// ==========================================
// 機能1: オブジェクト＆項目リファレンス
// ==========================================

function showLoading(show, message = "読み込み中...") {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (el && txt) {
    txt.textContent = message;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
}

async function initObjectReference() {
  const searchInput = document.getElementById('object-search');
  const countSpan = document.getElementById('object-count');

  showLoading(true, "オブジェクト一覧を取得中...");
  try {
    const data = await sfApiGet(`/services/data/v60.0/sobjects`);
    allObjects = data.sobjects;
    countSpan.textContent = allObjects.length;

    const dataList = document.getElementById('object-list');
    allObjects.forEach(obj => {
      const option = document.createElement('option');
      option.value = obj.name; // API名
      option.textContent = obj.label; // 表示ラベルをサジェストに表示
      dataList.appendChild(option);
    });

    searchInput.disabled = false;

    // 入力値が変わったとき（リストから選択されたとき含む）に自動取得
    searchInput.addEventListener('input', async (e) => {
      const selectedApiName = e.target.value;
      if (!selectedApiName) return;

      // 入力値が allObjects の API名 と完全一致するか確認
      const matched = allObjects.find(obj => obj.name === selectedApiName);
      if (matched) {
        // マッチした場合は自動的にAPIをコールして項目情報を取得
        await fetchObjectFields(selectedApiName);
      }
    });

  } catch (e) {
    console.error(e);
    alert('オブジェクト一覧の取得に失敗しました。');
  } finally {
    showLoading(false);
  }
}

async function fetchObjectFields(apiName) {
  showLoading(true, "項目情報を取得中...");
  try {
    const data = await sfApiGet(`/services/data/v60.0/sobjects/${apiName}/describe`);
    currentFields = data.fields;

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('object-details-container').classList.remove('hidden');
    document.getElementById('current-object-name').textContent = `${data.label} (${data.name}) の全項目`;

    renderFieldsTable(currentFields);

    // CSV出力ボタンの紐付け
    document.getElementById('btn-export-csv').onclick = () => exportToCsv(currentFields, data.name);

    // 項目検索用イベントリスナーの紐付けと初期化
    const fieldSearchInput = document.getElementById('field-search');
    fieldSearchInput.value = ''; // 別オブジェクト選択時にリセット
    fieldSearchInput.removeEventListener('input', handleFieldSearch); // 念の為古いリスナーを解除
    fieldSearchInput.addEventListener('input', handleFieldSearch);

  } catch (e) {
    alert(`項目の取得に失敗しました。\nAPI名「${apiName}」が正しいか確認してください。`);
    console.error(e);
  } finally {
    showLoading(false);
  }
}

// 項目検索のハンドラ
function handleFieldSearch(e) {
  const query = e.target.value.toLowerCase();

  // label か name のどちらかに query が含まれていれば残す
  const filtered = currentFields.filter(f => {
    return (f.label && f.label.toLowerCase().includes(query)) ||
      (f.name && f.name.toLowerCase().includes(query));
  });

  renderFieldsTable(filtered);
}

function renderFieldsTable(fields) {
  const tbody = document.getElementById('fields-table-body');
  tbody.innerHTML = '';

  if (fields.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" class="p-4 text-center text-slate-400 text-xs">項目が見つかりません</td>`;
    tbody.appendChild(tr);
    return;
  }

  fields.forEach(f => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50 transition group';

    const requiredBadge = (!f.nillable || f.name === 'Id')
      ? '<span class="px-1.5 py-0.5 rounded-sm bg-red-100 text-red-700 font-bold text-[10px]">必須</span>'
      : '';

    const customBadge = f.custom
      ? '<span class="px-1.5 py-0.5 rounded-sm bg-purple-100 text-purple-700 font-bold text-[10px]">カスタム</span>'
      : '<span class="text-slate-300 text-[10px]">標準</span>';

    // データ型に長さやスケールを付与 (例: string(255), double(16,2))
    let typeStr = f.type;
    if (f.type === 'string' || f.type === 'textarea' || f.type === 'url' || f.type === 'email' || f.type === 'phone') {
      typeStr += `(${f.length})`;
    } else if (f.type === 'double' || f.type === 'currency' || f.type === 'percent') {
      typeStr += `(${f.precision},${f.scale})`;
    } else if (f.type === 'reference') {
      // 参照先オブジェクトの表示
      if (f.referenceTo && f.referenceTo.length > 0) {
        typeStr += ` → ${f.referenceTo.join(', ')}`;
      }
    }

    tr.innerHTML = `
      <td class="p-2 pl-4 py-2 truncate max-w-[150px]" title="${f.label}">${f.label}</td>
      <td class="p-2 py-2 font-mono text-blue-600 font-medium">${f.name}</td>
      <td class="p-2 py-2 text-slate-500 font-mono text-[11px] truncate max-w-[160px]" title="${typeStr}">${typeStr}</td>
      <td class="p-2 py-2 text-center">${requiredBadge}</td>
      <td class="p-2 py-2 text-center">${customBadge}</td>
      <td class="p-2 pr-4 py-2 text-center">
        <button class="bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600 text-slate-600 px-2 py-1 rounded text-[10px] font-bold copy-btn transition shadow-sm w-[50px]" data-val="${f.name}">
          Copy
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // コピーボタンのイベントリスナー
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const btnEl = e.currentTarget;
      const val = btnEl.dataset.val;
      navigator.clipboard.writeText(val);

      const originalText = btnEl.textContent;
      // 成功時の見た目
      btnEl.textContent = 'OK!';
      btnEl.classList.add('bg-emerald-500', 'text-white', 'border-emerald-500');
      btnEl.classList.remove('bg-white', 'text-slate-600', 'border-slate-300');

      setTimeout(() => {
        btnEl.textContent = 'Copy';
        btnEl.classList.remove('bg-emerald-500', 'text-white', 'border-emerald-500');
        btnEl.classList.add('bg-white', 'text-slate-600', 'border-slate-300');
      }, 1000);
    });
  });
}

function exportToCsv(fields, objectName) {
  const headers = ['表示ラベル', 'API参照名', 'データ型', '必須', 'カスタム項目', '参照先'];
  const rows = fields.map(f => {
    const isRequired = (!f.nillable || f.name === 'Id') ? 'Yes' : 'No';
    const isCustom = f.custom ? 'Yes' : 'No';
    const referenceTo = (f.referenceTo && f.referenceTo.length > 0) ? f.referenceTo.join(';') : '';

    return [
      f.label,
      f.name,
      f.type,
      isRequired,
      isCustom,
      referenceTo
    ];
  });

  // エスケープ処理を含むCSV文字列の生成
  const escapeCsv = (str) => {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');

  // UTF-8 BOM付きで文字化けを防ぐ
  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${objectName}_Fields.csv`;
  document.body.appendChild(a); // Firefox等対策
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================
// 機能2: SOQL ランナー
// ==========================================
let soqlHistory = [];
let currentSoqlResult = null; // CSVダウンロード用
let soqlBuilderCurrentObject = '';
let soqlBuilderCurrentFields = [];
let soqlBuilderSelectedFields = new Set(); // 選択された項目プレフィックス

function initSoqlRunner() {
  const btnRun = document.getElementById('btn-run-soql');
  const inputSoql = document.getElementById('soql-input');
  const errorText = document.getElementById('soql-error');
  const historySelect = document.getElementById('soql-history');

  // Builder用の要素
  const builderObjSearch = document.getElementById('soql-object-search');
  const builderObjList = document.getElementById('soql-object-list');
  const builderFieldSearch = document.getElementById('soql-field-search');

  // 履歴のロード
  chrome.storage.local.get(['soqlHistory'], function (result) {
    if (result.soqlHistory && result.soqlHistory.length > 0) {
      soqlHistory = result.soqlHistory;
      updateHistorySelect();
    }
  });

  historySelect.addEventListener('change', (e) => {
    if (e.target.value) {
      inputSoql.value = e.target.value;
    }
  });

  inputSoql.addEventListener('keydown', (e) => {
    // Ctrl + Enter で実行
    if (e.ctrlKey && e.key === 'Enter') {
      btnRun.click();
    }
  });

  document.getElementById('btn-export-soql-csv').addEventListener('click', () => {
    if (!currentSoqlResult || currentSoqlResult.length === 0) return;
    exportSoqlCsv(currentSoqlResult);
  });

  btnRun.addEventListener('click', async () => {
    const query = inputSoql.value.trim();
    if (!query) return;

    errorText.textContent = '';
    showLoading(true, "SOQLを実行中...");

    try {
      const encodedQuery = encodeURIComponent(query);
      const data = await sfApiGet('/services/data/v60.0/query?q=' + encodedQuery);

      // 成功したら履歴に保存
      saveSoqlHistory(query);

      // テーブルの描画
      currentSoqlResult = data.records;
      renderSoqlResult(data);

    } catch (e) {
      // エラー表示
      currentSoqlResult = null;
      let errMsg = e.message;
      try {
        const jsonPart = errMsg.substring(errMsg.indexOf('['));
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          if (parsed && parsed[0] && parsed[0].message) errMsg = parsed[0].message;
        }
      } catch (ignore) { }

      errorText.textContent = errMsg;
      errorText.title = e.message;
      clearSoqlTable();
    } finally {
      showLoading(false);
    }
  });

  // --- SOQL Builder の機能 ---

  // 1. オブジェクト一覧を共有してセット
  // (initObjectReference 完了後なので allObjects が入っている前提)
  if (allObjects && allObjects.length > 0) {
    builderObjList.innerHTML = '';
    allObjects.forEach(obj => {
      const option = document.createElement('option');
      option.value = obj.name;
      option.textContent = obj.label;
      builderObjList.appendChild(option);
    });
  }

  // 2. オブジェクト選択イベント
  builderObjSearch.addEventListener('input', async (e) => {
    const selectedApiName = e.target.value;
    if (!selectedApiName) return;

    const matched = allObjects.find(obj => obj.name === selectedApiName);
    if (matched) {
      await fetchSoqlBuilderFields(selectedApiName);
    }
  });

  // 3. 項目リストのフィルタ
  builderFieldSearch.addEventListener('input', (e) => {
    renderSoqlBuilderFields(e.target.value.toLowerCase());
  });
}

// Builder用の項目取得
async function fetchSoqlBuilderFields(apiName) {
  showLoading(true, "クエリビルダ用項目を取得中...");
  try {
    const data = await sfApiGet(`/services/data/v60.0/sobjects/${apiName}/describe`);
    soqlBuilderCurrentObject = data.name;
    soqlBuilderCurrentFields = data.fields;

    // 選択状態をリセット
    soqlBuilderSelectedFields.clear();
    // デフォルトで Id を選択
    soqlBuilderSelectedFields.add('Id');

    document.getElementById('soql-field-search-container').classList.remove('hidden');
    document.getElementById('soql-field-search').value = '';

    renderSoqlBuilderFields('');
    updateSoqlQueryText();

  } catch (e) {
    console.error(e);
  } finally {
    showLoading(false);
  }
}

// Builder用の項目リスト描画 (チェックボックスつき)
function renderSoqlBuilderFields(filterQuery) {
  const container = document.getElementById('soql-field-list-container');
  container.innerHTML = '';

  const filtered = soqlBuilderCurrentFields.filter(f => {
    return !filterQuery ||
      (f.label && f.label.toLowerCase().includes(filterQuery)) ||
      (f.name && f.name.toLowerCase().includes(filterQuery));
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-[10px] text-slate-400 text-center mt-2">項目が見つかりません</p>';
    return;
  }

  filtered.forEach(f => {
    const labelWrap = document.createElement('label');
    labelWrap.className = 'flex items-start gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer transition';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500';
    cb.value = f.name;
    cb.checked = soqlBuilderSelectedFields.has(f.name);

    cb.addEventListener('change', (e) => {
      if (e.target.checked) {
        soqlBuilderSelectedFields.add(f.name);
      } else {
        soqlBuilderSelectedFields.delete(f.name);
      }
      updateSoqlQueryText();
    });

    const textWrap = document.createElement('div');
    textWrap.className = 'flex flex-col flex-1 min-w-0';
    textWrap.innerHTML = `
      <span class="text-[11px] font-bold text-slate-700 truncate" title="${f.label}">${f.label}</span>
      <span class="text-[9px] font-mono text-slate-500 truncate" title="${f.name}">${f.name}</span>
    `;

    labelWrap.appendChild(cb);
    labelWrap.appendChild(textWrap);

    // 必須アイコン
    if (!f.nillable || f.name === 'Id') {
      const req = document.createElement('span');
      req.className = 'w-1.5 h-1.5 bg-red-400 rounded-full mt-1.5 flex-shrink-0';
      labelWrap.appendChild(req);
    }

    container.appendChild(labelWrap);
  });
}

// SOQLのテキストエリアを更新
function updateSoqlQueryText() {
  const inputSoql = document.getElementById('soql-input');

  if (!soqlBuilderCurrentObject) return;

  let fieldsStr = 'Id';
  if (soqlBuilderSelectedFields.size > 0) {
    // Idを先頭にしつつ、残りをソートして結合
    const fields = Array.from(soqlBuilderSelectedFields);
    const idIdx = fields.indexOf('Id');
    if (idIdx !== -1) fields.splice(idIdx, 1);
    fields.sort();
    if (soqlBuilderSelectedFields.has('Id')) fields.unshift('Id');

    fieldsStr = fields.join(', ');
  }

  inputSoql.value = `SELECT ${fieldsStr} \nFROM ${soqlBuilderCurrentObject} \nLIMIT 50`;
}


function saveSoqlHistory(query) {
  soqlHistory = soqlHistory.filter(q => q !== query);
  soqlHistory.unshift(query);
  if (soqlHistory.length > 20) soqlHistory.pop();

  chrome.storage.local.set({ soqlHistory: soqlHistory });
  updateHistorySelect();
}

function updateHistorySelect() {
  const select = document.getElementById('soql-history');
  if (soqlHistory.length > 0) {
    select.classList.remove('hidden');
    select.innerHTML = '<option value="">履歴から選択...</option>';
    soqlHistory.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = q.replace(/\n/g, ' ').substring(0, 50) + (q.length > 50 ? '...' : '');
      select.appendChild(opt);
    });
  }
}

function clearSoqlTable() {
  document.getElementById('soql-table-head').innerHTML = '';
  document.getElementById('soql-table-body').innerHTML = '';
  document.getElementById('soql-empty-state').classList.remove('hidden');
  document.getElementById('soql-table').classList.add('hidden');
  document.getElementById('btn-export-soql-csv').classList.add('hidden');
  document.getElementById('soql-result-count').textContent = '';
}

function renderSoqlResult(data) {
  const thead = document.getElementById('soql-table-head');
  const tbody = document.getElementById('soql-table-body');
  const emptyState = document.getElementById('soql-empty-state');
  const table = document.getElementById('soql-table');
  const btnExport = document.getElementById('btn-export-soql-csv');
  const countSpan = document.getElementById('soql-result-count');

  thead.innerHTML = '';
  tbody.innerHTML = '';

  countSpan.textContent = '(' + data.records.length + '件' + (data.done ? '' : ' - 一部のみ表示') + ')';

  if (!data.records || data.records.length === 0) {
    emptyState.classList.remove('hidden');
    table.classList.add('hidden');
    btnExport.classList.add('hidden');
    emptyState.innerHTML = '<p class="text-xs text-slate-400">クエリは成功しましたが、レコードが見つかりませんでした。</p>';
    return;
  }

  emptyState.classList.add('hidden');
  table.classList.remove('hidden');
  btnExport.classList.remove('hidden');

  const allKeys = new Set();
  data.records.forEach(rec => {
    Object.keys(rec).forEach(k => {
      if (k !== 'attributes') allKeys.add(k);
    });
  });
  const headers = Array.from(allKeys);

  const trHead = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.className = 'p-1.5 px-3 font-bold text-slate-600 border-b border-slate-200';
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  data.records.forEach(rec => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-blue-50 transition border-b border-slate-100 last:border-0';

    headers.forEach(h => {
      const td = document.createElement('td');
      td.className = 'p-1.5 px-3 align-top';

      let val = rec[h];
      if (typeof val === 'object' && val !== null) {
        if (val.Name) val = val.Name;
        else val = '[Object]';
      }

      td.textContent = (val !== null && val !== undefined) ? val : '-';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function exportSoqlCsv(records) {
  if (!records || records.length === 0) return;

  const allKeys = new Set();
  records.forEach(rec => {
    Object.keys(rec).forEach(k => {
      if (k !== 'attributes') allKeys.add(k);
    });
  });
  const headers = Array.from(allKeys);

  const rows = records.map(rec => {
    return headers.map(h => {
      let val = rec[h];
      if (typeof val === 'object' && val !== null) {
        if (val.Name) val = val.Name;
        else val = JSON.stringify(val);
      }
      return val !== null && val !== undefined ? String(val) : '';
    });
  });

  const escapeCsv = (str) => {
    const s = String(str).replace(/"/g, '""');
    return '"' + s + '"';
  };

  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n');

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  const dateStr = d.getFullYear() + (d.getMonth() + 1).toString().padStart(2, '0') + d.getDate().toString().padStart(2, '0') + '_' + d.getHours().toString().padStart(2, '0') + d.getMinutes().toString().padStart(2, '0');
  a.download = 'SOQL_Export_' + dateStr + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

}

// ==========================================
// 機能3: 簡易 ER 関連図ジェネレーター
// ==========================================

function initErGenerator() {
  const erObjectSearch = document.getElementById('er-object-search');
  const erObjectList = document.getElementById('er-object-list');
  const btnOpenErTab = document.getElementById('btn-open-er-tab');

  if (allObjects && allObjects.length > 0 && erObjectList) {
    erObjectList.innerHTML = '';
    allObjects.forEach(obj => {
      const option = document.createElement('option');
      option.value = obj.name;
      option.textContent = obj.label;
      erObjectList.appendChild(option);
    });
  }

  if (btnOpenErTab) {
    btnOpenErTab.addEventListener('click', () => {
      const selectedObj = erObjectSearch.value.trim();
      if (!selectedObj) {
        alert('まずはオブジェクトを選択してください。');
        return;
      }

      const matched = allObjects.find(obj => obj.name === selectedObj || obj.label === selectedObj);
      if (!matched) {
        alert('無効なオブジェクト名です。リストから選択してください。');
        return;
      }

      chrome.tabs.create({ url: chrome.runtime.getURL(`er.html?obj=${matched.name}`) });
    });
  }
}
