# 한글 맞춤법 검사 크롬 확장 프로그램 기술 명세서

## 프로젝트 개요

### 목적
웹 브라우저에서 한글 텍스트 입력 시 실시간 맞춤법 검사 및 교정 기능을 제공하는 Chrome Extension

### 핵심 목표
- **효율성**: 디바운싱 + 문장 종료 기호 트리거로 최적화된 API 호출
- **가벼움**: 최소한의 리소스로 최대 효과
- **사용성**: 직관적이고 방해되지 않는 UX

## 기술 스택

- **Platform**: Chrome Extension Manifest V3
- **Language**: JavaScript (ES6+), HTML5, CSS3
- **API**: 부산대학교 × (주)나라인포테크 바른한글 맞춤법 검사기 API
- **Architecture**: Content Script + Background Service Worker

## 시스템 아키텍처

### 구조 다이어그램
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Popup UI      │    │  Background     │    │  Content Script │
│  (설정 관리)     │◄──►│   Service       │◄──►│   (실시간 검사)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │  API 서버       │
                       │ (맞춤법 검사기)  │
                       └─────────────────┘
```

### 파일 구조
```
spell-checker-extension/
├── manifest.json                 # 확장 프로그램 설정
├── background.js                 # Service Worker (API 통신)
├── content.js                    # Content Script (DOM 조작)
├── popup/
│   ├── popup.html               # 설정 UI
│   ├── popup.js                 # 설정 로직
│   └── popup.css                # 설정 스타일
├── styles/
│   └── content.css              # 검사 결과 스타일
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## API 명세

### 바른한글 맞춤법 검사기 API

#### 엔드포인트
```
POST https://dcplxo2e85.execute-api.ap-northeast-2.amazonaws.com/v1/PnuWebSpeller/check?weakOpt=0
```

#### 요청 형식
```json
{
    "method": "POST",
    "headers": {
        "x-api-key": "[API_KEY]",
        "Content-Type": "application/json"
    },
    "body": {
        "sentence": "검사할 텍스트"
    }
}
```

#### 응답 형식 (XML)
```xml
<?xml version='1.0' encoding='utf-8'?>
<PnuNlpSpeller>
    <PnuErrorWordList repeat='no'>
        <PnuErrorWord nErrorIdx='0' m_nStart='시작위치' m_nEnd='끝위치'>
            <OrgStr>원본 오류 텍스트</OrgStr>
            <CandWordList m_nCount='제안 개수'>
                <CandWord>수정 제안1</CandWord>
                <CandWord>수정 제안2</CandWord>
            </CandWordList>
            <Help nCorrectMethod='1'>
                <![CDATA[설명 내용]]>
            </Help>
        </PnuErrorWord>
    </PnuErrorWordList>
    <!-- 오류 발생 시 또는 오류 없을 때 -->
    <Error msg="문법 및 철자 오류가 발견되지 않았습니다." />
</PnuNlpSpeller>
```

#### 응답 형식 예시 (XML)
```xml
<?xml version='1.0' encoding='utf-8'?>
<PnuNlpSpeller>
    <PnuErrorWordList repeat='no'>
        <PnuErrorWord nErrorIdx='0' m_nStart='0' m_nEnd='4'>
            <OrgStr>오랫만에</OrgStr>
            <CandWordList m_nCount='1'>
                <CandWord>오랜만에</CandWord>
            </CandWordList>
            <Help nCorrectMethod='1'>
                <![CDATA[한글 맞춤법은 표준어를 소리대로 적되, 어법에 맞도록 함을 원칙으로 한다.<br/><br/>(예) 구름/나무/하늘/놀다<br/>(예) 꽃이[꼬치]<br/>(예) 꽃놀이[꼰노리]]]>
            </Help>
        </PnuErrorWord>
        <PnuErrorWord nErrorIdx='1' m_nStart='15' m_nEnd='27'>
            <OrgStr>어깨에 잘 못 맸습니다</OrgStr>
            <CandWordList m_nCount='2'>
                <CandWord>어깨에 잘못 멨습니다</CandWord>
                <CandWord>어깨에 잘못 묶었습니다</CandWord>
            </CandWordList>
            <Help nCorrectMethod='2'>
                <![CDATA[&apos;잘못&apos;이 &apos;잘하지 못하여 그릇되게 한 일&apos;을 뜻하는 명사, 또는 &apos;틀리거나 그릇되게&apos;를 뜻하는 부사로 쓰일 때는 한 단어이므로 붙여 씁니다. 아니면 띄어 씁니다.]]>
            </Help>
        </PnuErrorWord>
    </PnuErrorWordList>
</PnuNlpSpeller>
```

#### XML 구조 상세 설명

**노드 구조**:
- `<PnuNlpSpeller>`: 최상위 루트 노드
- `<PnuErrorWordList>`: 오류어 리스트 컨테이너
  - **repeat**: 반복교정 검사 여부 (`yes`/`no`)
- `<PnuErrorWord>`: 개별 오류어 정보
  - **nErrorIdx**: 오류어 번호 (0부터 순차 증가)
  - **m_nStart**: 원문에서 오류어 시작 위치 (0-based index)
  - **m_nEnd**: 원문에서 오류어 끝 위치
- `<OrgStr>`: 원본 오류 텍스트
- `<CandWordList>`: 수정 제안 리스트
  - **m_nCount**: 제안 개수 (0이면 제안 없음)
- `<CandWord>`: 개별 수정 제안
- `<Help>`: 문법 설명 (HTML 형식, `<br/>` 포함)
  - **nCorrectMethod**: 오류 유형 분류 (0-10)
- `<Error>`: 오류 상황 또는 결과 없음
  - **msg**: 오류 메시지 또는 "문법 및 철자 오류가 발견되지 않았습니다."

#### 오류 유형 분류 (nCorrectMethod)
```javascript
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
```

## 핵심 기능 설계

### 1. 스마트 트리거 시스템

#### 트리거 조건
1. **디바운싱**: 사용자 입력 중단 후 1.5초 대기
2. **문장 종료**: 한글 문장 부호 입력 시 즉시 실행
   - 마침표(.), 물음표(?), 느낌표(!)
   - 한글 마침표(。)

#### 구현 로직
```javascript
class SmartTrigger {
    constructor() {
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 1500; // 1.5초
        this.SENTENCE_ENDINGS = ['.', '?', '!', '。'];
    }

    onTextInput(text, event) {
        // 최소 길이 체크 (2자 이상)
        if (text.trim().length < 2) return;

        // 글자 수 제한 (400자)
        if (text.length > 400) {
            text = text.substring(0, 400);
        }

        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.checkSpelling(text);
        }, this.DEBOUNCE_DELAY);
    }

    onSentenceEnd(text, lastChar) {
        if (this.SENTENCE_ENDINGS.includes(lastChar)) {
            clearTimeout(this.debounceTimer);
            this.checkSpelling(text);
        }
    }
}
```

### 2. 효율적인 캐싱 시스템

#### 캐싱 전략
- **완전 일치**: 동일한 텍스트에 대해서만 캐시 활용
- **메모리 제한**: 최대 50개 결과 캐시
- **TTL**: 10분 후 자동 만료

```javascript
class SpellCheckCache {
    constructor() {
        this.cache = new Map();
        this.MAX_ENTRIES = 50;
        this.TTL = 10 * 60 * 1000; // 10분
    }

    get(text) {
        const key = this.generateKey(text);
        const cached = this.cache.get(key);

        if (cached && Date.now() - cached.timestamp < this.TTL) {
            return cached.result;
        }

        this.cache.delete(key);
        return null;
    }

    set(text, result) {
        const key = this.generateKey(text);

        // 캐시 크기 제한
        if (this.cache.size >= this.MAX_ENTRIES) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            result,
            timestamp: Date.now()
        });
    }

    generateKey(text) {
        return btoa(unescape(encodeURIComponent(text))); // UTF-8 safe hash
    }
}
```

### 3. 안전한 입력 필드 필터링

#### 제외 대상
```javascript
const EXCLUDED_SELECTORS = [
    // 보안 관련
    'input[type="password"]',
    'input[type="email"]',
    'input[name*="password"]',
    'input[name*="pwd"]',

    // 개인정보 관련
    'input[name*="card"]',
    'input[name*="ssn"]',
    'input[name*="phone"]',
    'input[name*="tel"]',

    // 검색 및 URL
    'input[type="search"]',
    'input[name*="url"]',
    'input[name*="link"]',

    // 명시적 제외
    '[data-no-spellcheck]',
    '.no-spellcheck',

    // 코드 에디터
    '.ace_editor',
    '.CodeMirror',
    'pre input',
    'code input'
];

const EXCLUDED_HOSTNAMES = [
    'accounts.google.com',
    'login.naver.com',
    'signin.*.com'
];
```

### 4. 오류 표시 및 수정 UI (오류가 있을 때만 표시)

#### 오류 하이라이팅 (오류 유형별 시각화)
```css
/* 기본 오류 스타일 */
.spell-error {
    cursor: pointer;
    position: relative;
    border-radius: 2px;
    transition: all 0.2s ease;
}

/* 오류 유형별 색상 */
.spell-error[data-error-type="1"] { /* 형태소 분석 불가 */
    border-bottom: 2px wavy #dc3545;
    background-color: rgba(220, 53, 69, 0.1);
}

.spell-error[data-error-type="2"] { /* 오용어 */
    border-bottom: 2px wavy #fd7e14;
    background-color: rgba(253, 126, 20, 0.1);
}

.spell-error[data-error-type="3"] { /* 다수어절 오류 */
    border-bottom: 2px wavy #e83e8c;
    background-color: rgba(232, 62, 140, 0.1);
}

.spell-error[data-error-type="4"] { /* 의미 문체 오류 */
    border-bottom: 2px wavy #6f42c1;
    background-color: rgba(111, 66, 193, 0.1);
}

.spell-error[data-error-type="5"] { /* 문장 부호 오류 */
    border-bottom: 2px wavy #20c997;
    background-color: rgba(32, 201, 151, 0.1);
}

.spell-error[data-error-type="6"] { /* 통계정보 붙여쓰기 */
    border-bottom: 2px wavy #17a2b8;
    background-color: rgba(23, 162, 184, 0.1);
}

.spell-error[data-error-type="7"] { /* 영어 오용어 */
    border-bottom: 2px wavy #ffc107;
    background-color: rgba(255, 193, 7, 0.1);
}

.spell-error[data-error-type="8"] { /* 태깅 오류 */
    border-bottom: 2px wavy #6c757d;
    background-color: rgba(108, 117, 125, 0.1);
}

.spell-error[data-error-type="9"] { /* 복합명사 언더바 오류 */
    border-bottom: 2px wavy #343a40;
    background-color: rgba(52, 58, 64, 0.1);
}

.spell-error[data-error-type="10"] { /* 형태별 붙여쓰기 */
    border-bottom: 2px wavy #007bff;
    background-color: rgba(0, 123, 255, 0.1);
}

/* 호버 효과 */
.spell-error:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* 적용된 수정 */
.spell-error.applied {
    background-color: rgba(40, 167, 69, 0.2);
    border-bottom: none;
    text-decoration: line-through;
}

/* 무시된 오류 */
.spell-error.ignored {
    opacity: 0.5;
    border-bottom-style: dotted;
}

/* 반복 검사에서 발견된 오류 */
.spell-error.repeat-check {
    border-left: 3px solid #17a2b8;
    padding-left: 4px;
}
```

#### 수정 제안 툴팁 (자동 수정 기능 포함)
```html
<div class="spell-tooltip" data-error-id="${error.id}">
    <!-- 헤더 -->
    <div class="tooltip-header">
        <span class="original-text">"${error.original}"</span>
        <span class="error-type-badge" style="background-color: ${error.type.color}">
            ${error.type.description}
        </span>
    </div>

    <!-- 수정 제안 목록 (제안이 있는 경우에만 표시) -->
    ${error.suggestions.length > 0 ? `
        <div class="suggestion-list">
            ${error.suggestions.map((suggestion, index) => `
                <div class="suggestion-item" data-suggestion="${suggestion}" data-index="${index}">
                    <span class="suggestion-text">${suggestion}</span>
                    <button class="apply-btn" data-suggestion="${suggestion}" data-index="${index}">
                        수정
                    </button>
                </div>
            `).join('')}
        </div>
    ` : ''}

    <!-- 문법 설명 (있는 경우에만 표시) -->
    ${error.description ? `
        <div class="explanation">
            ${error.getPlainDescription()}
        </div>
    ` : ''}

    <!-- 액션 버튼 -->
    <div class="actions">
        <button class="ignore-btn">무시</button>
    </div>
</div>
```

#### 툴팁 스타일링 (간소화)
```css
.spell-tooltip {
    position: absolute;
    background: white;
    border: 1px solid #ddd;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    max-width: 300px;
    padding: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
}

.tooltip-header {
    margin-bottom: 8px;
}

.original-text {
    font-weight: 600;
    color: #333;
    margin-right: 8px;
}

.error-type-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 10px;
    color: white;
    font-size: 10px;
    font-weight: 500;
}

.suggestion-list {
    margin: 8px 0;
}

.suggestion-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    margin: 2px 0;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    transition: background-color 0.2s ease;
}

.suggestion-item:hover {
    background-color: #f8f9fa;
    border-color: #007bff;
}

.suggestion-text {
    flex: 1;
    margin-right: 8px;
}

.apply-btn {
    padding: 2px 6px;
    border: 1px solid #007bff;
    border-radius: 3px;
    background: #007bff;
    color: white;
    cursor: pointer;
    font-size: 10px;
    font-weight: 500;
    transition: all 0.2s ease;
}

.apply-btn:hover {
    background: #0056b3;
    border-color: #0056b3;
}

.explanation {
    margin: 8px 0;
    color: #555;
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
}

.actions {
    margin-top: 8px;
    text-align: right;
}

.ignore-btn {
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: white;
    cursor: pointer;
    font-size: 11px;
}

.ignore-btn:hover {
    background: #f8f9fa;
}
```

## 데이터 모델

### SpellError 객체
```javascript
class SpellError {
    constructor(errorIdx, start, end, original, suggestions, description, correctMethod = 1) {
        this.errorIdx = errorIdx;         // 오류 번호 (number, API의 nErrorIdx)
        this.start = start;              // 오류 시작 위치 (number, 0-based)
        this.end = end;                  // 오류 끝 위치 (number)
        this.original = original;        // 원본 오류 텍스트 (string)
        this.suggestions = suggestions;  // 수정 제안 배열 (string[])
        this.description = description;  // 문법 설명 (string, HTML 포함 가능)
        this.correctMethod = correctMethod; // 오류 유형 (number, 0-10)
        this.type = this.getErrorType(); // 오류 타입 정보 (object)
        this.id = this.generateId();    // 고유 ID (string)
        this.isApplied = false;         // 수정 적용 여부 (boolean)
        this.isIgnored = false;         // 무시 여부 (boolean)
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

    // 수정 제안 적용 (자동 수정)
    applySuggestion(suggestionIndex = 0) {
        if (this.suggestions.length > suggestionIndex) {
            this.isApplied = true;
            this.appliedSuggestion = this.suggestions[suggestionIndex];
            return this.suggestions[suggestionIndex];
        }
        return null;
    }

    // 수정 상태 초기화
    resetAppliedState() {
        this.isApplied = false;
        this.appliedSuggestion = null;
    }

    // 오류 무시
    ignore() {
        this.isIgnored = true;
    }

    // HTML 형식의 설명을 일반 텍스트로 변환
    getPlainDescription() {
        return this.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    }
}
```

### API 응답 결과 객체
```javascript
class SpellCheckResult {
    constructor() {
        this.errors = [];              // SpellError 배열
        this.hasRepeatCheck = false;   // 반복 교정 검사 여부
        this.isSuccess = true;         // 검사 성공 여부
        this.errorMessage = '';        // 오류 메시지
        this.originalText = '';        // 원본 텍스트
        this.processedAt = new Date(); // 처리 시간
    }

    // 오류 추가
    addError(spellError) {
        this.errors.push(spellError);
    }

    // 오류 개수
    getErrorCount() {
        return this.errors.length;
    }

    // 특정 유형의 오류만 반환
    getErrorsByType(correctMethod) {
        return this.errors.filter(error => error.correctMethod === correctMethod);
    }

    // 무시되지 않은 오류만 반환
    getActiveErrors() {
        return this.errors.filter(error => !error.isIgnored && !error.isApplied);
    }

    // 결과가 "오류 없음" 메시지인지 확인
    isNoErrorMessage() {
        return this.errorMessage.includes('문법 및 철자 오류가 발견되지 않았습니다');
    }
}
```

### 설정 객체
```javascript
const DEFAULT_SETTINGS = {
    apiKey: '',
    enabled: true,
    debounceDelay: 1500,
    maxTextLength: 400,
    showExplanation: true,
    autoApplySuggestion: false
};
```

## 확장 프로그램 구현

### Manifest.json
```json
{
    "manifest_version": 3,
    "name": "한글 맞춤법 검사기",
    "version": "1.0.0",
    "description": "실시간 한글 맞춤법 검사 및 교정",

    "permissions": [
        "storage",
        "activeTab"
    ],

    "host_permissions": [
        "https://dcplxo2e85.execute-api.ap-northeast-2.amazonaws.com/*"
    ],

    "content_scripts": [{
        "matches": ["<all_urls>"],
        "js": ["content.js"],
        "css": ["styles/content.css"],
        "run_at": "document_idle"
    }],

    "background": {
        "service_worker": "background.js"
    },

    "action": {
        "default_popup": "popup/popup.html",
        "default_title": "한글 맞춤법 검사기"
    },

    "icons": {
        "16": "icons/icon16.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
    }
}
```

### Content Script 아키텍처
```javascript
class ContentSpellChecker {
    constructor() {
        this.settings = null;
        this.cache = new SpellCheckCache();
        this.trigger = new SmartTrigger();
        this.currentTooltip = null;
        this.isChecking = false;
    }

    async init() {
        // 설정 로드
        this.settings = await this.loadSettings();
        if (!this.settings.enabled || !this.settings.apiKey) return;

        // 이벤트 리스너 등록
        this.attachEventListeners();

        // DOM 변화 감지
        this.observeDOM();
    }

    attachEventListeners() {
        // 입력 이벤트
        document.addEventListener('input', this.handleInput.bind(this));

        // 키 입력 이벤트 (문장 종료 감지)
        document.addEventListener('keypress', this.handleKeyPress.bind(this));

        // 클릭 이벤트 (툴팁 닫기 및 수정 버튼 처리)
        document.addEventListener('click', this.handleClick.bind(this));

        // 설정 변경 감지
        chrome.storage.onChanged.addListener(this.handleSettingsChange.bind(this));
    }

    async handleInput(event) {
        const target = event.target;
        if (!this.isValidTarget(target)) return;

        const text = target.value || target.textContent;

        // 기존 오류 표시 제거
        this.clearErrors(target);

        // 맞춤법 검사 실행
        await this.trigger.onTextInput(text, event);
    }

    clearErrors(element) {
        // 해당 요소의 모든 오류 표시 제거
        const errorElements = element.querySelectorAll('.spell-error');
        errorElements.forEach(errorEl => {
            const parent = errorEl.parentNode;
            parent.replaceChild(document.createTextNode(errorEl.textContent), errorEl);
            parent.normalize();
        });

        // 열려있는 툴팁 제거
        this.closeTooltip();
    }

    displayErrors(element, errors) {
        if (errors.length === 0) return; // 오류가 없으면 아무것도 표시하지 않음

        // 오류가 있는 경우에만 하이라이팅 적용
        errors.sort((a, b) => b.start - a.start); // 뒤에서부터 처리

        errors.forEach(error => {
            this.highlightError(element, error);
        });
    }

    highlightError(element, error) {
        // 텍스트 내용에서 오류 위치 찾기
        const text = element.value || element.textContent;
        const before = text.substring(0, error.start);
        const errorText = text.substring(error.start, error.end);
        const after = text.substring(error.end);

        // 오류 영역을 span으로 감싸기
        const errorSpan = document.createElement('span');
        errorSpan.className = 'spell-error';
        errorSpan.setAttribute('data-error-type', error.correctMethod);
        errorSpan.setAttribute('data-error-id', error.id);
        errorSpan.textContent = errorText;

        // 마우스 호버 이벤트 추가
        errorSpan.addEventListener('mouseenter', (e) => {
            this.showTooltip(e, error);
        });

        errorSpan.addEventListener('mouseleave', () => {
            this.hideTooltip();
        });

        // 텍스트 교체 (contentEditable 또는 일반 텍스트)
        if (element.contentEditable === 'true') {
            // contentEditable 요소 처리
            this.replaceInContentEditable(element, error.start, error.end, errorSpan);
        } else {
            // input/textarea 요소는 value로 처리 (DOM 조작 불가)
            this.addErrorMarker(element, error);
        }
    }

    // 자동 수정 기능
    applyCorrection(element, error, suggestionIndex) {
        const suggestion = error.suggestions[suggestionIndex];
        if (!suggestion) return;

        // 원본 텍스트에서 교정 적용
        const text = element.value || element.textContent;
        const before = text.substring(0, error.start);
        const after = text.substring(error.end);
        const correctedText = before + suggestion + after;

        // 텍스트 업데이트
        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
            element.value = correctedText;
        } else if (element.contentEditable === 'true') {
            element.textContent = correctedText;
        }

        // 오류 상태 업데이트
        error.applySuggestion(suggestionIndex);

        // 시각적 피드백
        this.showCorrectionFeedback(element, suggestion);

        // 툴팁 닫기
        this.closeTooltip();

        // 입력 이벤트 발생 (다른 오류 재검사를 위해)
        const inputEvent = new Event('input', { bubbles: true });
        element.dispatchEvent(inputEvent);
    }

    showCorrectionFeedback(element, suggestion) {
        // 수정 완료 시각적 피드백 (1초간 초록색 배경)
        element.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
        element.style.transition = 'background-color 0.3s ease';

        setTimeout(() => {
            element.style.backgroundColor = '';
        }, 1000);
    }

    // 클릭 이벤트 처리 (수정 버튼 및 툴팁 닫기)
    handleClick(event) {
        const target = event.target;

        // 수정 버튼 클릭 처리
        if (target.classList.contains('apply-btn')) {
            event.preventDefault();
            event.stopPropagation();

            const suggestion = target.getAttribute('data-suggestion');
            const index = parseInt(target.getAttribute('data-index'));
            const errorId = target.closest('.spell-tooltip').getAttribute('data-error-id');

            // 해당 오류 찾기
            const errorElement = document.querySelector(`[data-error-id="${errorId}"]`);
            const inputElement = this.findInputElement(errorElement);
            const error = this.findErrorById(errorId);

            if (error && inputElement) {
                this.applyCorrection(inputElement, error, index);
            }
            return;
        }

        // 무시 버튼 클릭 처리
        if (target.classList.contains('ignore-btn')) {
            event.preventDefault();
            event.stopPropagation();

            const errorId = target.closest('.spell-tooltip').getAttribute('data-error-id');
            const error = this.findErrorById(errorId);

            if (error) {
                error.ignore();
                this.closeTooltip();
                // 시각적으로 무시된 상태 표시
                const errorElement = document.querySelector(`[data-error-id="${errorId}"]`);
                if (errorElement) {
                    errorElement.classList.add('ignored');
                }
            }
            return;
        }

        // 툴팁 외부 클릭 시 닫기
        if (!target.closest('.spell-tooltip') && !target.classList.contains('spell-error')) {
            this.closeTooltip();
        }
    }

    findInputElement(errorElement) {
        // 오류 요소로부터 상위 입력 요소 찾기
        return errorElement.closest('textarea, input[type="text"], [contenteditable="true"]');
    }

    findErrorById(errorId) {
        // 현재 검사 결과에서 오류 ID로 찾기
        // 실제 구현에서는 현재 검사 결과를 저장하고 있어야 함
        return this.currentErrors?.find(error => error.id === errorId);
    }

    handleKeyPress(event) {
        const target = event.target;
        if (!this.isValidTarget(target)) return;

        const text = target.value || target.textContent;
        this.trigger.onSentenceEnd(text, event.key);
    }

    isValidTarget(element) {
        // 제외 대상 체크
        for (const selector of EXCLUDED_SELECTORS) {
            if (element.matches(selector)) return false;
        }

        // 제외 호스트 체크
        if (EXCLUDED_HOSTNAMES.some(host => window.location.hostname.includes(host))) {
            return false;
        }

        // 입력 가능한 요소인지 체크
        return element.tagName === 'TEXTAREA' ||
               (element.tagName === 'INPUT' && element.type === 'text') ||
               element.contentEditable === 'true';
    }
}
```

### Background Service Worker
```javascript
// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkSpelling') {
        performSpellCheck(request.text, request.apiKey)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // 비동기 응답 유지
    }
});

async function performSpellCheck(text, apiKey) {
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
    return parseSpellCheckResponse(xmlText);
}

function parseSpellCheckResponse(xmlText, originalText = '') {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    // 결과 객체 생성
    const result = new SpellCheckResult();
    result.originalText = originalText;

    // XML 파싱 오류 체크
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
        result.isSuccess = false;
        result.errorMessage = 'XML 파싱 오류: ' + parseError.textContent;
        return result;
    }

    // Error 노드 체크 (오류 발생 또는 오류 없음)
    const errorNode = xmlDoc.querySelector('Error');
    if (errorNode) {
        const errorMsg = errorNode.getAttribute('msg') || '';
        result.errorMessage = errorMsg;

        // "오류가 발견되지 않았습니다" 메시지는 정상 상황
        if (result.isNoErrorMessage()) {
            result.isSuccess = true;
            return result;
        } else {
            // 실제 오류 상황
            result.isSuccess = false;
            return result;
        }
    }

    // 반복 교정 검사 여부 확인
    const errorWordList = xmlDoc.querySelector('PnuErrorWordList');
    if (errorWordList) {
        const repeat = errorWordList.getAttribute('repeat');
        result.hasRepeatCheck = repeat === 'yes';
    }

    // 오류어 노드들 파싱
    const errorNodes = xmlDoc.querySelectorAll('PnuErrorWord');

    errorNodes.forEach(node => {
        const errorIdx = parseInt(node.getAttribute('nErrorIdx')) || 0;
        const start = parseInt(node.getAttribute('m_nStart')) || 0;
        const end = parseInt(node.getAttribute('m_nEnd')) || 0;
        const original = node.querySelector('OrgStr')?.textContent || '';

        // Help 노드에서 설명과 교정 방법 추출
        const helpNode = node.querySelector('Help');
        let description = '';
        let correctMethod = 1; // 기본값

        if (helpNode) {
            description = helpNode.textContent || '';
            correctMethod = parseInt(helpNode.getAttribute('nCorrectMethod')) || 1;
        }

        // 수정 제안 추출
        const suggestions = [];
        const candWordList = node.querySelector('CandWordList');

        if (candWordList) {
            const candCount = parseInt(candWordList.getAttribute('m_nCount')) || 0;

            if (candCount > 0) {
                const candNodes = node.querySelectorAll('CandWord');
                candNodes.forEach(cand => {
                    const suggestion = cand.textContent?.trim();
                    if (suggestion) {
                        suggestions.push(suggestion);
                    }
                });
            }
        }

        // SpellError 객체 생성 및 추가
        const spellError = new SpellError(
            errorIdx, start, end, original,
            suggestions, description, correctMethod
        );

        result.addError(spellError);
    });

    return result;
}

// 반복 교정 검사 처리 함수
async function performRepeatCheck(result, apiKey) {
    if (!result.hasRepeatCheck || result.errors.length === 0) {
        return result;
    }

    // 첫 번째 수정 제안으로 텍스트 교정
    let correctedText = result.originalText;

    // 뒤에서부터 교정하여 인덱스 변화 방지
    const sortedErrors = [...result.errors].sort((a, b) => b.start - a.start);

    for (const error of sortedErrors) {
        if (error.suggestions.length > 0) {
            const before = correctedText.substring(0, error.start);
            const after = correctedText.substring(error.end);
            correctedText = before + error.suggestions[0] + after;
        }
    }

    // 교정된 텍스트로 재검사
    try {
        const xmlText = await performSpellCheckAPI(correctedText, apiKey);
        const repeatResult = parseSpellCheckResponse(xmlText, correctedText);

        // 반복 검사 결과를 원본 결과에 추가
        if (repeatResult.isSuccess && repeatResult.errors.length > 0) {
            repeatResult.errors.forEach(error => {
                // 반복 검사에서 발견된 오류는 별도 표시
                error.isFromRepeatCheck = true;
                result.addError(error);
            });
        }

        return result;
    } catch (error) {
        console.warn('반복 교정 검사 실패:', error);
        return result;
    }
}
```

## 성능 최적화

### 1. API 호출 최적화
- **최소 텍스트 길이**: 2자 이상
- **최대 텍스트 길이**: 400자
- **디바운싱**: 1.5초
- **캐싱**: 완전 일치 텍스트

### 2. DOM 조작 최적화
- **DocumentFragment** 사용으로 리플로우 최소화
- **이벤트 위임** 패턴으로 메모리 효율성
- **requestAnimationFrame** 활용한 UI 업데이트

### 3. 메모리 관리
```javascript
class MemoryManager {
    cleanup() {
        // 이벤트 리스너 정리
        document.removeEventListener('input', this.handleInput);
        document.removeEventListener('keypress', this.handleKeyPress);

        // 툴팁 정리
        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }

        // 캐시 정리
        this.cache.clear();
    }
}
```

## 오류 처리

### API 오류 처리
```javascript
class ErrorHandler {
    static handle(error, context) {
        console.error(`SpellChecker Error [${context}]:`, error);

        switch (error.code) {
            case 401:
                this.notifyInvalidAPIKey();
                break;
            case 429:
                this.notifyRateLimit();
                break;
            case 'NETWORK_ERROR':
                this.notifyNetworkError();
                break;
            default:
                this.notifyGenericError();
        }
    }

    static notifyUser(message, type = 'error') {
        // 사용자에게 알림 표시 (침투적이지 않게)
        const notification = document.createElement('div');
        notification.className = `spell-notification spell-${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}
```

## 보안 고려사항

### 1. API 키 보안
- Chrome Storage API `sync` 사용
- API 키 암호화 저장 (기본 보호)
- 개발자 도구에서 접근 차단

### 2. 데이터 보호
- HTTPS 통신 강제
- 민감한 필드 자동 제외
- 사용자 동의 없는 데이터 전송 금지

### 3. XSS 방지
```javascript
function sanitizeText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
```

## 개발 단계별 계획

### Phase 1: MVP (최소 기능 제품)
**목표**: 디바운싱 + 문장 종료 트리거로 효율적이고 가벼운 기본 기능

#### 필수 기능
- [ ] Chrome Extension 기본 구조
- [ ] API 키 설정 UI
- [ ] 스마트 트리거 시스템 (디바운싱 + 문장 종료)
- [ ] 기본 오류 표시 (빨간 밑줄)
- [ ] 수정 제안 툴팁
- [ ] 완전 일치 캐싱
- [ ] 안전한 입력 필드 필터링

#### 기술 요구사항
- 최대 400자 텍스트 처리
- 1.5초 디바운싱
- 2자 이상 검사
- 오류가 있는 경우에만 시각적 표시

### Phase 2: 고도화 기능
**목표**: 사용성 및 성능 향상

#### 추가 기능
- [ ] IME 조합 중 검사 스킵 (event.isComposing 체크)
- [ ] 키보드 단축키 지원 (F1-F9 수정 적용, Esc 닫기)
- [ ] 사용자 설정 확장 (디바운싱 시간 조정)
- [ ] 증분 검사 기능 (변경된 부분만 검사)
- [ ] 고급 필터링 (사이트별 설정)
- [ ] 사용 통계 및 분석
- [ ] 다국어 지원 (English UI)
- [ ] 성능 최적화 (Web Worker 활용)

## 테스트 계획

### 1. 단위 테스트
```javascript
// 예시: XML 파싱 테스트
describe('SpellCheck XML Parser', () => {
    test('should parse valid XML response', () => {
        const xmlResponse = `<?xml version='1.0' encoding='utf-8'?>...`;
        const errors = parseSpellCheckResponse(xmlResponse);
        expect(errors).toHaveLength(1);
        expect(errors[0].original).toBe('잘못된단어');
    });
});
```

### 2. 통합 테스트
- API 통신 테스트
- 캐싱 기능 테스트
- 트리거 로직 테스트

### 3. E2E 테스트
- 다양한 웹사이트에서 동작 확인
- 성능 벤치마크 (응답시간, 메모리 사용량)
- 사용성 테스트

### 4. 브라우저 호환성
- Chrome 88+ (Manifest V3 지원)
- Edge 88+
- Opera 74+

## 배포 계획

### Chrome 웹 스토어 등록
1. **확장 프로그램 패키징**
   - manifest.json 검증
   - 아이콘 및 스크린샷 준비
   - 개인정보 처리방침 작성

2. **스토어 정책 준수**
   - 사용자 데이터 보호 정책
   - API 사용 제한 명시
   - 접근 권한 최소화

3. **버전 관리**
   - Semantic Versioning (1.0.0)
   - 자동 업데이트 지원
   - 변경 로그 관리

---

## 부록

### API 키 발급 안내
- **API 제공**: 부산대학교 × (주)나라인포테크
- **이메일 문의**: urimal@pusan.ac.kr
- **발급 조건**: 개인 사용자 무료
