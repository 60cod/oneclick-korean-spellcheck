// background.js - Service Worker for API communication
importScripts('storage.js');

// 첫 설치 시 팝업 표시
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        const isSetup = await ApiKeyStorage.isSetup();
        if (!isSetup) {
            chrome.action.openPopup();
        }
    }
});

// SpellError 클래스 정의
class SpellError {
    constructor(errorIdx, start, end, original, suggestions, description, correctMethod = 1) {
        this.errorIdx = errorIdx;
        this.start = start;
        this.end = end;
        this.original = original;
        this.suggestions = suggestions;
        this.description = description;
        this.correctMethod = correctMethod;
        this.type = this.getErrorType();
        this.id = this.generateId();
        this.isApplied = false;
        this.isIgnored = false;
    }

    getErrorType() {
        const ERROR_TYPES = {
            0: { name: 'NO_ERROR', description: '에러 없음', color: '#28a745' },
            1: { name: 'MORPHEME_ANALYSIS_FAILED', description: '형태소 분석 불가', color: '#dc3545' },
            2: { name: 'MISUSED_WORD', description: '오용어', color: '#fd7e14' },
            3: { name: 'MULTI_PHRASE_ERROR', description: '다수어절 오류', color: '#e83e8c' },
            4: { name: 'SEMANTIC_STYLE_ERROR', description: '의미 문체 오류', color: '#6f42c1' },
            5: { name: 'PUNCTUATION_ERROR', description: '문장 부호 오류', color: '#20c997' },
            6: { name: 'STATISTICAL_SPACING', description: '통계정보 붙여쓰기', color: '#17a2b8' },
            7: { name: 'ENGLISH_MISUSE', description: '영어 오용어', color: '#ffc107' },
            8: { name: 'TAGGING_ERROR', description: '태깅 오류', color: '#6c757d' },
            9: { name: 'COMPOUND_UNDERSCORE', description: '복합명사 언더바 오류', color: '#343a40' },
            10: { name: 'SPACING_BY_TYPE', description: '형태별 붙여쓰기', color: '#007bff' }
        };
        return ERROR_TYPES[this.correctMethod] || ERROR_TYPES[1];
    }

    generateId() {
        return `spell-error-${this.errorIdx}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// SpellCheckResult 클래스 정의
class SpellCheckResult {
    constructor() {
        this.errors = [];
        this.hasRepeatCheck = false;
        this.isSuccess = true;
        this.errorMessage = '';
        this.originalText = '';
        this.processedAt = new Date();
    }

    addError(spellError) {
        this.errors.push(spellError);
    }

    getErrorCount() {
        return this.errors.length;
    }

    isNoErrorMessage() {
        return this.errorMessage.includes('문법 및 철자 오류가 발견되지 않았습니다');
    }
}

// 메시지 리스너 등록
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkSpelling') {
        handleSpellCheck(request.text, sendResponse);
        return true; // 비동기 응답 유지
    }

    if (request.action === 'setApiKey') {
        ApiKeyStorage.set(request.apiKey)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'checkSetup') {
        ApiKeyStorage.isSetup()
            .then(isSetup => sendResponse({ isSetup }))
            .catch(() => sendResponse({ isSetup: false }));
        return true;
    }

    if (request.action === 'toggleExtension') {
        // 확장 프로그램 활성화 상태 변경
        chrome.storage.local.set({ extensionEnabled: request.enabled })
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// 스펠체크 처리 함수
async function handleSpellCheck(text, sendResponse) {
    try {
        // 확장 프로그램 활성화 상태 확인
        const { extensionEnabled = true } = await chrome.storage.local.get('extensionEnabled');

        if (!extensionEnabled) {
            sendResponse({
                success: false,
                error: '확장 프로그램이 비활성화되어 있습니다.',
                disabled: true
            });
            return;
        }

        const apiKey = await ApiKeyStorage.getDecoded();

        if (!apiKey) {
            sendResponse({
                success: false,
                error: 'API 키가 설정되지 않았습니다.',
                needsSetup: true
            });
            return;
        }

        const result = await performSpellCheck(text, apiKey);
        sendResponse({ success: true, data: result });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// API 호출 함수
async function performSpellCheck(text, apiKey) {
    try {
        const response = await fetch(
            'https://dcplxo2e85.execute-api.ap-northeast-2.amazonaws.com/v1/PnuWebSpeller/check?weakOpt=0',
            {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sentence: text })
            }
        );

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const xmlText = await response.text();
        return parseSpellCheckResponse(xmlText, text);
    } catch (error) {
        throw error;
    }
}

// XML 파싱 함수 (Service Worker용 간단 파싱)
function parseSpellCheckResponse(xmlText, originalText = '') {
    // Service Worker에서는 DOMParser가 없으므로 정규식으로 파싱
    const result = new SpellCheckResult();
    result.originalText = originalText;

    // Error 노드 체크
    const errorMatch = xmlText.match(/<Error[^>]*msg="([^"]*)"[^>]*\/>/);
    if (errorMatch) {
        result.errorMessage = errorMatch[1];
        result.isSuccess = result.isNoErrorMessage();
        return result;
    }

    // PnuErrorWord 노드들 추출
    const errorWordMatches = xmlText.matchAll(/<PnuErrorWord[^>]*nErrorIdx='(\d+)'[^>]*m_nStart='(\d+)'[^>]*m_nEnd='(\d+)'[^>]*>(.*?)<\/PnuErrorWord>/gs);

    for (const match of errorWordMatches) {
        const errorIdx = parseInt(match[1]) || 0;
        const start = parseInt(match[2]) || 0;
        const end = parseInt(match[3]) || 0;
        const content = match[4];

        // OrgStr 추출
        const orgStrMatch = content.match(/<OrgStr>(.*?)<\/OrgStr>/);
        const original = orgStrMatch ? orgStrMatch[1] : '';

        // Help 정보 추출
        const helpMatch = content.match(/<Help[^>]*nCorrectMethod='(\d+)'[^>]*><!\[CDATA\[(.*?)\]\]><\/Help>/s);
        const correctMethod = helpMatch ? parseInt(helpMatch[1]) : 1;
        const description = helpMatch ? helpMatch[2] : '';

        // 수정 제안 추출
        const suggestions = [];
        const candWordMatches = content.matchAll(/<CandWord>(.*?)<\/CandWord>/g);
        for (const candMatch of candWordMatches) {
            const suggestion = candMatch[1].trim();
            if (suggestion) {
                suggestions.push(suggestion);
            }
        }

        // SpellError 객체 생성 및 추가
        const spellError = new SpellError(
            errorIdx, start, end, original,
            suggestions, description, correctMethod
        );

        result.addError(spellError);
    }

    return result;
}

