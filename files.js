// files.js

document.addEventListener('DOMContentLoaded', async () => {
    const statusText = document.getElementById('status-text');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    const searchKeyword = document.getElementById('search-keyword');
    const searchExt = document.getElementById('search-ext');
    const searchLimit = document.getElementById('search-limit');
    const btnSearch = document.getElementById('btn-search');

    const tableBody = document.getElementById('files-table-body');
    const emptyState = document.getElementById('files-empty-state');
    const resultCount = document.getElementById('result-count');
    const checkAll = document.getElementById('check-all');

    const selectionStatus = document.getElementById('selection-status');
    const selectedCountSpan = document.getElementById('selected-count');
    const selectedSizeSpan = document.getElementById('selected-size');
    const btnDownloadZip = document.getElementById('btn-download-zip');
    const limitWarning = document.getElementById('limit-warning');

    const progressContainer = document.getElementById('download-progress-container');
    const progressBar = document.getElementById('download-progress-bar');
    const progressText = document.getElementById('download-progress-text');

    let currentFiles = [];

    // Initialize logic
    async function init() {
        try {
            const sfInfo = await getSalesforceSession();
            if (sfInfo) {
                window.currentSfInfo = sfInfo;
                chrome.storage.local.set({ 'sfInfo': sfInfo });
                statusText.textContent = chrome.i18n.getMessage('statusConnected') || `Connected: ${sfInfo.domain}`;
                statusText.classList.replace('text-slate-500', 'text-emerald-700');
                statusText.classList.replace('bg-slate-100', 'bg-emerald-50');
                statusText.classList.replace('border-slate-200', 'border-emerald-200');
            } else {
                statusText.textContent = chrome.i18n.getMessage('statusNotConnected') || 'Not Connected';
            }
        } catch (error) {
            console.error('Initialization error:', error);
            statusText.textContent = 'Error connecting to Salesforce';
            statusText.classList.add('text-red-600');
        }
    }

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function formatDate(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return d.toLocaleString();
    }

    function updateSelectionState() {
        const checkboxes = document.querySelectorAll('.file-checkbox:checked');
        let totalSize = 0;
        let count = checkboxes.length;

        checkboxes.forEach(cb => {
            const index = parseInt(cb.dataset.index, 10);
            totalSize += currentFiles[index].ContentSize || 0;
        });

        selectedCountSpan.textContent = count;
        selectedSizeSpan.textContent = formatBytes(totalSize);

        const MAX_FILES = 50;
        const MAX_MB = 50; // 50MB
        const MAX_BYTES = MAX_MB * 1024 * 1024;

        if (count > 0) {
            selectionStatus.classList.remove('hidden');
            btnDownloadZip.classList.remove('hidden');
        } else {
            selectionStatus.classList.add('hidden');
            btnDownloadZip.classList.add('hidden');
            limitWarning.classList.add('hidden');
        }

        if (count > MAX_FILES || totalSize > MAX_BYTES) {
            btnDownloadZip.disabled = true;
            limitWarning.classList.remove('hidden');
        } else {
            btnDownloadZip.disabled = false;
            limitWarning.classList.add('hidden');
        }

        checkAll.checked = (count === currentFiles.length && currentFiles.length > 0);
    }

    btnSearch.addEventListener('click', async () => {
        const kw = searchKeyword.value.trim();
        const ext = searchExt.value;
        const limit = parseInt(searchLimit.value, 10);

        loadingText.textContent = chrome.i18n.getMessage('loadingMsg') || 'Searching files...';
        loadingOverlay.classList.remove('hidden');
        btnSearch.disabled = true;

        try {
            currentFiles = await searchContentVersions(kw, ext, limit);
            renderTable();
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
        } finally {
            loadingOverlay.classList.add('hidden');
            btnSearch.disabled = false;
        }
    });

    function renderTable() {
        tableBody.innerHTML = '';
        checkAll.checked = false;
        updateSelectionState();

        if (currentFiles.length === 0) {
            emptyState.classList.remove('hidden');
            emptyState.querySelector('p').textContent = '条件に一致するファイルがありませんでした。';
            resultCount.classList.add('hidden');
            checkAll.disabled = true;
            return;
        }

        emptyState.classList.add('hidden');
        resultCount.textContent = `${currentFiles.length}件`;
        resultCount.classList.remove('hidden');
        checkAll.disabled = false;

        currentFiles.forEach((f, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-50 transition';

            const ext = f.FileExtension ? f.FileExtension.toLowerCase() : 'unknown';

            tr.innerHTML = `
                <td class="p-3 pl-4 text-center">
                    <input type="checkbox" class="file-checkbox w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" data-index="${idx}">
                </td>
                <td class="p-3 font-medium text-blue-700 truncate max-w-xs" title="${f.Title}">
                    <a href="https://${window.currentSfInfo.domain}/lightning/r/ContentDocument/${f.ContentDocumentId}/view" target="_blank" class="hover:underline hover:text-blue-800">${f.Title}</a>
                </td>
                <td class="p-3">
                    <span class="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 font-mono uppercase">${ext}</span>
                </td>
                <td class="p-3 text-right font-mono text-xs text-slate-500">${formatBytes(f.ContentSize)}</td>
                <td class="p-3 text-xs text-slate-500">${formatDate(f.CreatedDate)}</td>
                <td class="p-3 text-xs text-slate-500 truncate max-w-[150px]" title="${f.CreatedBy?.Name || '-'}">${f.CreatedBy?.Name || '-'}</td>
                <td class="p-3 pr-4 text-center">
                    <button class="text-slate-500 hover:text-blue-600 transition dl-single-btn disabled:opacity-50 disabled:cursor-not-allowed" data-index="${idx}" title="Download">
                        <svg class="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                        </svg>
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectionState);
        });

        document.querySelectorAll('.dl-single-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.dataset.index, 10);
                const fileRec = currentFiles[idx];
                
                const btnEl = e.currentTarget;
                btnEl.disabled = true;
                const originalHTML = btnEl.innerHTML;
                btnEl.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mx-auto"></div>`;

                try {
                    const blob = await fetchFileBinary(fileRec.Id);
                    let fileName = fileRec.Title;
                    if (fileRec.FileExtension && !fileName.endsWith(`.${fileRec.FileExtension}`)) {
                        fileName += `.${fileRec.FileExtension}`;
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (err) {
                    console.error(err);
                    alert(`Error downloading file: ${err.message}`);
                } finally {
                    btnEl.disabled = false;
                    btnEl.innerHTML = originalHTML;
                }
            });
        });
    }

    checkAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        updateSelectionState();
    });

    // ZIP Download Logic
    btnDownloadZip.addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('.file-checkbox:checked');
        if (checkboxes.length === 0) return;

        progressContainer.classList.remove('hidden');
        btnDownloadZip.disabled = true;
        btnSearch.disabled = true;
        checkAll.disabled = true;
        document.querySelectorAll('.file-checkbox').forEach(cb => cb.disabled = true);

        const zip = new JSZip();
        let total = checkboxes.length;
        let done = 0;

        // Generate a folder name based on current date
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const folderName = `sf_files_${dateStr}`;
        const folder = zip.folder(folderName);

        try {
            for (const cb of checkboxes) {
                const idx = parseInt(cb.dataset.index, 10);
                const fileRec = currentFiles[idx];

                // update UI
                progressText.textContent = `${done} / ${total}`;
                progressBar.style.width = `${(done / total) * 100}%`;

                // Fetch Blob
                const blob = await fetchFileBinary(fileRec.Id);

                let fileName = fileRec.Title;
                if (fileRec.FileExtension && !fileName.endsWith(`.${fileRec.FileExtension}`)) {
                    fileName += `.${fileRec.FileExtension}`;
                }

                // Add to zip
                folder.file(fileName, blob);

                done++;
                progressText.textContent = `${done} / ${total}`;
                progressBar.style.width = `${(done / total) * 100}%`;
            }

            // Generate ZIP
            loadingText.textContent = 'ZIPファイルを生成中...';
            loadingOverlay.classList.remove('hidden');

            const zipBlob = await zip.generateAsync({ type: 'blob' });

            // Download
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${folderName}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error(error);
            alert(`Error during download: ${error.message}`);
        } finally {
            progressContainer.classList.add('hidden');
            btnDownloadZip.disabled = false;
            btnSearch.disabled = false;
            checkAll.disabled = false;
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.disabled = false);
            loadingOverlay.classList.add('hidden');

            // Uncheck all after successful download
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
            updateSelectionState();
        }
    });

    // Run init
    init();
});
