// ==========================================
// API & 認証処理 (Shared)
// ==========================================

// --- UI localization ---
function localizeUI() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
        if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
        if (msg) el.setAttribute('placeholder', msg);
    });
}

document.addEventListener('DOMContentLoaded', localizeUI);

async function sfApiGet(path, sfInfo) {
    let info = sfInfo || window.currentSfInfo;

    // 如果 window.currentSfInfo が未定義の場合、storage から取得を試みる（ER図の別タブ等のフォールバック）
    if (!info) {
        const result = await chrome.storage.local.get(['sfInfo']);
        if (result.sfInfo) {
            info = result.sfInfo;
            window.currentSfInfo = info; // キャッシュしておく
        }
    }

    if (!info) {
        throw new Error('Salesforce のセッション情報が見つかりません。連携をやり直してください。');
    }

    const apiUrl = `https://${info.domain}${path}`;
    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${info.sessionId}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP Error: ${response.status} - ${txt}`);
    }
    return response.json();
}

async function getSalesforceSession() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return null;

    const tab = tabs[0];
    if (!tab.url || tab.url.startsWith('chrome://')) return null;

    const url = new URL(tab.url);

    if (!url.hostname.includes('.force.com') && !url.hostname.includes('.salesforce.com')) {
        return null;
    }

    // ブラウザに保存されているすべての 'sid' クッキーを取得
    const cookies = await chrome.cookies.getAll({ name: 'sid' });
    if (!cookies || cookies.length === 0) return null;

    // 現在のタブのURLから取得できるsidを基準にOrgIdを取得する
    const localCookie = await chrome.cookies.get({ url: tab.url, name: 'sid' });
    let orgId = null;
    if (localCookie) {
        orgId = localCookie.value.split('!')[0];
    }

    // APIアクセス用（.my.salesforce.comなど）のCookieを探す
    let apiCookie = null;
    let fallbackCookie = null;

    for (const c of cookies) {
        if (orgId && !c.value.startsWith(orgId)) continue; // 別組織のセッションを除外

        // Developer Edition や API用のドメインを持つCookieを優先する
        if (c.domain.includes('.my.salesforce.com') || c.domain.includes('.salesforce.com')) {
            if (!apiCookie || c.domain.includes('.my.salesforce.com')) {
                apiCookie = c;
            }
        }

        // orgIdに合致する何らかのクッキーをフォールバックとして保持
        fallbackCookie = c;
    }

    // 適切なクッキーを選択
    const selectedCookie = apiCookie || localCookie || fallbackCookie;
    if (!selectedCookie) return null;

    let apiDomain = selectedCookie.domain;
    if (apiDomain.startsWith('.')) {
        apiDomain = apiDomain.substring(1); // 先頭のピリオドを削除
    }

    // Lightning特有のURLの場合、API用にドメインを補正（Developer Edition対策）
    if (apiDomain.includes('.lightning.force.com')) {
        apiDomain = apiDomain.replace('.lightning.force.com', '.my.salesforce.com');
    }

    return {
        domain: apiDomain,
        sessionId: selectedCookie.value,
        orgId: selectedCookie.value.split('!')[0]
    };
}

async function testSalesforceApi(sfInfo) {
    const apiUrl = `https://${sfInfo.domain}/services/data/v60.0/`;
    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${sfInfo.sessionId}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            return { success: true };
        } else {
            const text = await response.text();
            return { success: false, status: response.status, errorMsg: text, apiUrl };
        }
    } catch (error) {
        console.error('API Test Error:', error);
        return { success: false, status: 'Network Error', errorMsg: error.message, apiUrl };
    }
}

// --- SOQL escape helper ---
function escapeSoql(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// --- Background Logic ---
async function fetchBackgroundLogic(apiName) {
    const info = window.currentSfInfo;
    if (!info) throw new Error('Salesforce のセッション情報が見つかりません。');

    const enc = encodeURIComponent;

    // Queries (Tooling API and Data API)
    const safeApiName = escapeSoql(apiName);
    const qTrigger = `SELECT Id, Name, Status, UsageIsBulk FROM ApexTrigger WHERE TableEnumOrId = '${safeApiName}'`;
    // ValidationRule requires EntityDefinitionId for safe filtering
    const qValidationSafe = `SELECT Id, ValidationName, Active, Description FROM ValidationRule WHERE EntityDefinitionId = '${safeApiName}'`;
    const qFlow = `SELECT ApiName, ActiveVersionId, Label, TriggerType, ProcessType FROM FlowDefinitionView WHERE TriggerObjectOrEventId = '${safeApiName}'`;

    // Execute fetches in parallel. Using Tooling API where needed.
    const pTrigger = sfApiGet(`/services/data/v60.0/tooling/query?q=${enc(qTrigger)}`).catch(e => ({ records: [], error: e.message }));
    const pValidation = sfApiGet(`/services/data/v60.0/tooling/query?q=${enc(qValidationSafe)}`).catch(e => ({ records: [], error: e.message }));
    const pFlow = sfApiGet(`/services/data/v60.0/query?q=${enc(qFlow)}`).catch(e => ({ records: [], error: e.message }));

    const [triggerRes, validationRes, flowRes] = await Promise.all([pTrigger, pValidation, pFlow]);

    return {
        triggers: triggerRes.records || [],
        validationRules: validationRes.records || [],
        flows: flowRes.records || [],
        errors: {
            trigger: triggerRes.error,
            validation: validationRes.error,
            flow: flowRes.error
        }
    };
}

// --- Files ---
async function searchContentVersions(keyword, extension, limit = 50) {
    let q = `SELECT Id, ContentDocumentId, Title, FileExtension, ContentSize, CreatedDate, CreatedBy.Name FROM ContentVersion WHERE IsLatest = true`;

    if (keyword) {
        q += ` AND Title LIKE '%${escapeSoql(keyword)}%'`;
    }
    if (extension) {
        q += ` AND FileExtension = '${escapeSoql(extension)}'`;
    }

    q += ` ORDER BY CreatedDate DESC LIMIT ${limit}`;

    const enc = encodeURIComponent(q);
    const res = await sfApiGet(`/services/data/v60.0/query?q=${enc}`);
    return res.records || [];
}

async function fetchFileBinary(contentVersionId) {
    const info = window.currentSfInfo;
    if (!info) {
        const result = await chrome.storage.local.get(['sfInfo']);
        if (result.sfInfo) {
            window.currentSfInfo = result.sfInfo;
        } else {
            throw new Error('Salesforce のセッション情報が見つかりません。');
        }
    }

    const apiUrl = `https://${window.currentSfInfo.domain}/services/data/v60.0/sobjects/ContentVersion/${contentVersionId}/VersionData`;
    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${window.currentSfInfo.sessionId}`
        }
    });

    if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP Error fetching file: ${response.status} - ${txt}`);
    }

    return await response.blob();
}
