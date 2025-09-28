// content.js - Content Script for DOM manipulation and spell checking

// 제외 대상 선택자
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

// 스마트 트리거 클래스
class SmartTrigger {
    constructor() {
        this.debounceTimer = null;
        this.DEBOUNCE_DELAY = 1500; // 1.5초
        this.SENTENCE_ENDINGS = ['.', '?', '!', '。'];
    }

    onTextInput(text, callback) {
        // 최소 길이 체크 (2자 이상)
        if (text.trim().length < 2) return;

        // 글자 수 제한 (400자)
        if (text.length > 400) {
            text = text.substring(0, 400);
        }

        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            callback(text);
        }, this.DEBOUNCE_DELAY);
    }

    onSentenceEnd(text, lastChar, callback) {
        if (this.SENTENCE_ENDINGS.includes(lastChar)) {
            clearTimeout(this.debounceTimer);
            callback(text);
        }
    }
}

// 캐싱 시스템
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

// 메인 컨텐트 스펠체커 클래스
class ContentSpellChecker {
    constructor() {
        this.cache = new SpellCheckCache();
        this.trigger = new SmartTrigger();
        this.currentTooltip = null;
        this.isChecking = false;
        this.currentErrors = [];
        this.ignoredErrors = new Set(); // Track ignored errors
        this.extensionInvalidated = false;
        this.tooltipHideTimer = null;
    }

    async init() {
        // 제외 대상 호스트 체크
        if (this.isExcludedHostname()) return;

        // 이벤트 리스너 등록
        this.attachEventListeners();

    }

    attachEventListeners() {
        // 입력 이벤트
        document.addEventListener('input', this.handleInput.bind(this));

        // 키 입력 이벤트 (문장 종료 감지)
        document.addEventListener('keypress', this.handleKeyPress.bind(this));

        // 클릭 이벤트 (툴팁 닫기 및 수정 버튼 처리)
        document.addEventListener('click', this.handleClick.bind(this));
    }

    async handleInput(event) {
        const target = event.target;
        if (!this.isValidTarget(target)) return;

        const text = target.value || target.textContent;

        // 기존 오류 표시 제거
        this.clearErrors(target);

        // 맞춤법 검사 실행
        this.trigger.onTextInput(text, (text) => {
            this.checkSpelling(text, target);
        });
    }

    handleKeyPress(event) {
        const target = event.target;
        if (!this.isValidTarget(target)) return;

        const text = target.value || target.textContent;
        this.trigger.onSentenceEnd(text, event.key, (text) => {
            this.checkSpelling(text, target);
        });
    }

    async checkSpelling(text, element) {
        if (this.isChecking || this.extensionInvalidated) return;

        // 캐시 확인
        const cached = this.cache.get(text);
        if (cached) {
            this.displayErrors(element, cached.errors);
            return;
        }

        this.isChecking = true;

        try {
            // Extension context 유효성 체크
            if (!chrome.runtime?.id) {
                this.extensionInvalidated = true;
                return;
            }

            const response = await chrome.runtime.sendMessage({
                action: 'checkSpelling',
                text: text
            });

            // 응답이 undefined면 extension이 invalidated됨
            if (!response) {
                this.extensionInvalidated = true;
                return;
            }

            if (response.success) {
                const result = response.data;
                this.currentErrors = result.errors;

                // Filter out ignored errors
                const filteredErrors = result.errors.filter(error => {
                    const errorKey = `${error.start}-${error.end}-${error.original}`;
                    return !this.ignoredErrors.has(errorKey);
                });

                if (filteredErrors.length === 0) {
                    return; // No errors to display after filtering
                }

                // 캐시 저장
                this.cache.set(text, result);

                // 오류 표시 (filtered errors)
                this.displayErrors(element, filteredErrors);
            } else {
                // API 키 설정이 필요한 경우
                if (response.needsSetup) {
                    this.showSetupMessage();
                }
            }
        } catch (error) {
            // Extension context invalidated 에러는 조용히 처리
            if (error.message?.includes('Extension context invalidated') ||
                error.message?.includes('message channel closed')) {
                this.extensionInvalidated = true;
                return;
            }
        } finally {
            this.isChecking = false;
        }
    }

    isValidTarget(element) {
        // 제외 대상 체크
        for (const selector of EXCLUDED_SELECTORS) {
            if (element.matches(selector)) return false;
        }

        // 입력 가능한 요소인지 체크
        return element.tagName === 'TEXTAREA' ||
               (element.tagName === 'INPUT' && element.type === 'text') ||
               element.contentEditable === 'true';
    }

    isExcludedHostname() {
        return EXCLUDED_HOSTNAMES.some(host => window.location.hostname.includes(host));
    }

    clearErrors(element) {
        // Remove input overlay
        const inputOverlay = element.parentNode?.querySelector('.spell-input-overlay');
        if (inputOverlay) {
            inputOverlay.remove();
        }

        // Remove old overlay (backward compatibility)
        const existingOverlay = element.parentNode?.querySelector('.spell-error-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        // Remove contentEditable error spans
        const errorElements = element.querySelectorAll ? element.querySelectorAll('.spell-error') : [];
        errorElements.forEach(errorEl => {
            const parent = errorEl.parentNode;
            parent.replaceChild(document.createTextNode(errorEl.textContent), errorEl);
            parent.normalize();
        });

        // Reset element styling
        element.removeAttribute('data-spell-errors');
        element.style.borderLeft = '';
        element.style.border = '';

        // Close tooltip
        this.closeTooltip();
    }

    displayErrors(element, errors) {
        this.clearErrors(element);

        if (errors.length === 0) return;

        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
            this.displayInputErrors(element, errors);
        } else {
            this.displayContentEditableErrors(element, errors);
        }
    }

    displayInputErrors(element, errors) {
        // Create overlay highlighting for input/textarea
        this.createInputErrorOverlay(element, errors);

        // Add click event for tooltip
        element.addEventListener('click', () => {
            this.showTooltip(element, errors);
        });
    }

    createInputErrorOverlay(element, errors) {
        const text = element.value || '';
        if (!text.trim()) return;

        // Create overlay container
        const overlay = document.createElement('div');
        overlay.className = 'spell-input-overlay';
        // Store reference to the input element for later lookup
        overlay._inputElement = element;
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 1;
            font: inherit;
            padding: ${getComputedStyle(element).padding};
            border: ${getComputedStyle(element).borderWidth} solid transparent;
            box-sizing: border-box;
            white-space: pre-wrap;
            overflow: hidden;
            color: transparent;
            background: transparent;
        `;

        element.style.position = 'relative';

        // Create highlighted text with proper DOM elements
        this.buildOverlayContent(overlay, text, errors);

        element.parentNode.insertBefore(overlay, element.nextSibling);
    }

    buildOverlayContent(overlay, text, errors) {
        const sortedErrors = errors.sort((a, b) => a.start - b.start); // Forward order
        let currentPos = 0;

        sortedErrors.forEach((error, index) => {
            // Add text before error
            if (error.start > currentPos) {
                const beforeText = text.substring(currentPos, error.start);
                overlay.appendChild(document.createTextNode(beforeText));
            }

            // Create error span with events
            const errorText = text.substring(error.start, error.end);
            const span = document.createElement('span');
            span.className = `spell-error error-type-${error.correctMethod}`;
            // Create unique error ID and add to error spans
            const errorId = `${error.start}-${error.end}-${error.original}`;
            span.setAttribute('data-error-id', errorId);
            span.style.cssText = `
                color: transparent;
                text-decoration: underline wavy;
                text-decoration-color: ${this.getErrorColor(error.correctMethod)};
                text-decoration-thickness: 2px;
                text-underline-offset: 2px;
                pointer-events: auto;
                cursor: help;
            `;
            span.textContent = errorText;
            span.title = `${error.original} → ${error.suggestions?.join(' | ') || '수정 제안 없음'}`;

            // Add hover and click events
            span.addEventListener('mouseenter', (e) => {
                this.showTooltipImmediate(span, [error]);
            });

            span.addEventListener('mouseleave', (e) => {
                this.hideTooltip();
            });

            span.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showTooltip(span, [error]);
            });

            overlay.appendChild(span);
            currentPos = error.end;
        });

        // Add remaining text after last error
        if (currentPos < text.length) {
            const afterText = text.substring(currentPos);
            overlay.appendChild(document.createTextNode(afterText));
        }
    }

    displayContentEditableErrors(element, errors) {
        // For contentEditable, highlight text ranges directly using precise text matching
        const text = element.textContent || element.innerText;

        // Sort errors by position to handle them in order
        const sortedErrors = errors.sort((a, b) => a.start - b.start);

        sortedErrors.forEach(error => {
            this.highlightErrorInContentEditable(element, error);
        });
    }

    highlightErrorInContentEditable(element, error) {
        // Find all text nodes in the element
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }

        // Calculate cumulative text positions
        let currentPos = 0;
        for (let textNode of textNodes) {
            const nodeText = textNode.textContent;
            const nodeStart = currentPos;
            const nodeEnd = currentPos + nodeText.length;

            // Check if this text node contains our error
            if (error.start >= nodeStart && error.start < nodeEnd) {
                const startOffset = error.start - nodeStart;
                const endOffset = Math.min(error.end - nodeStart, nodeText.length);

                // Create range for the error text
                const range = document.createRange();

                try {
                    // Handle case where error spans beyond this text node
                    if (error.end <= nodeEnd) {
                        // Error is completely within this text node
                        range.setStart(textNode, startOffset);
                        range.setEnd(textNode, endOffset);
                    } else {
                        // Error spans multiple nodes - just handle this node's portion
                        range.setStart(textNode, startOffset);
                        range.setEnd(textNode, nodeText.length);
                    }

                    // Create span element for highlighting
                    const span = document.createElement('span');
                    span.className = `spell-error error-type-${error.correctMethod}`;
                    span.title = `${error.original} → ${error.suggestions?.join(' | ') || '수정 제안 없음'}`;
                    // Create unique error ID and add to error spans
                    const errorId = `${error.start}-${error.end}-${error.original}`;
                    span.setAttribute('data-error-id', errorId);
                    span.setAttribute('data-error-start', error.start);
                    span.setAttribute('data-error-end', error.end);

                    // Add hover and click event listeners
                    span.addEventListener('mouseenter', (e) => {
                        this.showTooltip(span, [error]);
                    });

                    span.addEventListener('mouseleave', (e) => {
                        this.hideTooltip();
                    });

                    span.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showTooltip(span, [error]);
                    });

                    // Surround the range with our span
                    range.surroundContents(span);

                } catch (e) {
                    // Fallback: split text node manually
                    this.manualHighlight(textNode, startOffset, endOffset, error);
                }
                break;
            }

            currentPos += nodeText.length;
        }
    }

    manualHighlight(textNode, startOffset, endOffset, error) {
        const text = textNode.textContent;
        const beforeText = text.substring(0, startOffset);
        const errorText = text.substring(startOffset, endOffset);
        const afterText = text.substring(endOffset);

        // Create new elements
        const beforeNode = document.createTextNode(beforeText);
        const span = document.createElement('span');
        span.className = `spell-error error-type-${error.correctMethod}`;
        span.title = `${error.original} → ${error.suggestions?.join(' | ') || '수정 제안 없음'}`;
        // Create unique error ID and add to error spans
        const errorId = `${error.start}-${error.end}-${error.original}`;
        span.setAttribute('data-error-id', errorId);
        span.setAttribute('data-error-start', error.start);
        span.setAttribute('data-error-end', error.end);
        span.textContent = errorText;

        // Add hover and click event listeners
        span.addEventListener('mouseenter', (e) => {
            this.showTooltip(span, [error]);
        });

        span.addEventListener('mouseleave', (e) => {
            this.hideTooltip();
        });

        span.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTooltip(span, [error]);
        });

        const afterNode = document.createTextNode(afterText);

        // Replace the original text node
        const parent = textNode.parentNode;
        parent.insertBefore(beforeNode, textNode);
        parent.insertBefore(span, textNode);
        parent.insertBefore(afterNode, textNode);
        parent.removeChild(textNode);
    }

    getErrorColor(errorType) {
        const colors = {
            1: '#ff4444',  // 맞춤법
            2: '#ff6600',  // 띄어쓰기
            3: '#ff8800',  // 표준어
            4: '#ffaa00',  // 사용법
            5: '#ffcc00',  // 문법
            6: '#cccc00',  // 문장부호
            7: '#88cc00',  // 높임법
            8: '#44cc00',  // 호응
            9: '#00cc44',  // 중복
            10: '#0088cc'  // 기타
        };
        return colors[errorType] || '#ff4444';
    }



    showTooltip(element, errors) {
        this.closeTooltip();

        if (!errors || errors.length === 0) return;

        const error = errors[0]; // Show first error
        const tooltip = document.createElement('div');
        tooltip.className = 'spell-tooltip';
        // Create unique error ID for tooltip
        const errorId = `${error.start}-${error.end}-${error.original}`;
        tooltip.setAttribute('data-error-id', errorId);

        // Build suggestions list from correct property
        const candidates = error.suggestions || [];

        tooltip.innerHTML = `
            <div class="tooltip-header">
                <span class="original-text">"${error.original || error.orgStr || 'Unknown'}"</span>
                <span class="error-type-badge" style="background-color: ${this.getErrorColor(error.correctMethod)}">
                    ${this.getErrorTypeName(error.correctMethod)}
                </span>
            </div>
            ${candidates.length > 0 ? `
                <div class="suggestion-list">
                    ${candidates.map((candidate, index) => `
                        <div class="suggestion-item" data-suggestion="${candidate}" data-index="${index}">
                            <span class="suggestion-text">${candidate}</span>
                            <button class="apply-btn" data-suggestion="${candidate}" data-index="${index}">
                                수정
                            </button>
                        </div>
                    `).join('')}
                </div>
            ` : '<div class="no-suggestions">수정 제안이 없습니다</div>'}
            ${error.description ? `
                <div class="explanation">
                    ${error.description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')}
                </div>
            ` : ''}
            <div class="actions">
                <button class="ignore-btn">무시</button>
            </div>
        `;

        // 포지셔닝
        const rect = element.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.bottom + 5) + 'px';
        tooltip.style.zIndex = '9999';
        tooltip.style.backgroundColor = 'white';
        tooltip.style.border = '1px solid #ccc';
        tooltip.style.borderRadius = '4px';
        tooltip.style.padding = '8px';
        tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        tooltip.style.maxWidth = '300px';

        // Add hover events to tooltip itself to keep it visible
        tooltip.addEventListener('mouseenter', (e) => {
            // Cancel hide timer when hovering over tooltip
            if (this.tooltipHideTimer) {
                clearTimeout(this.tooltipHideTimer);
                this.tooltipHideTimer = null;
            }
        });

        tooltip.addEventListener('mouseleave', (e) => {
            // Start hide timer when leaving tooltip
            this.hideTooltip();
        });

        document.body.appendChild(tooltip);
        this.currentTooltip = tooltip;
    }

    getErrorTypeName(correctMethod) {
        const types = {
            1: '맞춤법 오류',
            2: '띄어쓰기 오류',
            3: '표준어 오류',
            4: '사용법 오류',
            5: '문법 오류',
            6: '문장부호 오류',
            7: '높임법 오류',
            8: '호응 오류',
            9: '중복 표현',
            10: '기타 오류'
        };
        return types[correctMethod] || '오류';
    }

    hideTooltip() {
        // Clear any existing timer
        if (this.tooltipHideTimer) {
            clearTimeout(this.tooltipHideTimer);
        }

        // Set 2-second delay before hiding
        this.tooltipHideTimer = setTimeout(() => {
            this.closeTooltip();
            this.tooltipHideTimer = null;
        }, 2000);
    }

    showTooltipImmediate(element, errors) {
        // Clear any pending hide timer when showing tooltip
        if (this.tooltipHideTimer) {
            clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = null;
        }
        this.showTooltip(element, errors);
    }

    closeTooltip() {
        // Clear hide timer if tooltip is being closed manually
        if (this.tooltipHideTimer) {
            clearTimeout(this.tooltipHideTimer);
            this.tooltipHideTimer = null;
        }

        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }
    }

    handleClick(event) {
        const target = event.target;

        // 수정 버튼 클릭 처리
        if (target.classList.contains('apply-btn')) {
            event.preventDefault();
            event.stopPropagation();

            const suggestion = target.getAttribute('data-suggestion');
            const index = parseInt(target.getAttribute('data-index'));
            const errorId = target.closest('.spell-tooltip').getAttribute('data-error-id');

            this.applyCorrection(errorId, suggestion, index);
            return;
        }

        // 무시 버튼 클릭 처리
        if (target.classList.contains('ignore-btn')) {
            event.preventDefault();
            event.stopPropagation();

            const errorId = target.closest('.spell-tooltip').getAttribute('data-error-id');
            this.ignoreError(errorId);
            return;
        }

        // 툴팁 외부 클릭 시 닫기
        if (!target.closest('.spell-tooltip') && !target.classList.contains('spell-error')) {
            this.closeTooltip();
        }
    }

    applyCorrection(errorId, suggestion, index) {
        const errorElement = document.querySelector(`[data-error-id="${errorId}"]`);
        if (!errorElement) {
            console.warn('Error element not found:', errorId);
            return;
        }

        const inputElement = this.findInputElement(errorElement);
        const error = this.findErrorById(errorId);

        if (error && inputElement) {
            // 텍스트 교체
            const text = inputElement.value || inputElement.textContent;
            const before = text.substring(0, error.start);
            const after = text.substring(error.end);
            const correctedText = before + suggestion + after;

            if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
                inputElement.value = correctedText;
            } else if (inputElement.contentEditable === 'true') {
                inputElement.textContent = correctedText;
            }

            // 툴팁 닫기
            this.closeTooltip();

            // 입력 이벤트 발생
            const inputEvent = new Event('input', { bubbles: true });
            inputElement.dispatchEvent(inputEvent);
        } else {
            console.warn('Cannot apply correction:', {
                hasError: !!error,
                hasInputElement: !!inputElement
            });
        }
    }

    ignoreError(errorId) {
        // Add to ignored errors set
        this.ignoredErrors.add(errorId);

        // Hide all error elements with this ID
        const errorElements = document.querySelectorAll(`[data-error-id="${errorId}"]`);
        errorElements.forEach(element => {
            element.classList.add('ignored');
            element.style.display = 'none'; // Hide completely
        });

        this.closeTooltip();
    }

    showCorrectionFeedback(element) {
        element.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
        element.style.transition = 'background-color 0.3s ease';

        setTimeout(() => {
            element.style.backgroundColor = '';
        }, 1000);
    }

    findInputElement(errorElement) {
        // First try to find parent input (for contentEditable)
        let inputElement = errorElement.closest('textarea, input[type="text"], [contenteditable="true"]');

        if (inputElement) {
            return inputElement;
        }

        // If not found, check if error element is in an overlay
        const overlay = errorElement.closest('.spell-input-overlay');
        if (overlay) {
            // Use stored reference to the input element
            if (overlay._inputElement) {
                return overlay._inputElement;
            }
        }

        return null;
    }

    findErrorById(errorId) {
        return this.currentErrors?.find(error => {
            const id = `${error.start}-${error.end}-${error.original}`;
            return id === errorId;
        });
    }

    showSetupMessage() {
        // 설정 안내 메시지 (한 번만 표시)
        if (this.setupMessageShown) return;
        this.setupMessageShown = true;

        const message = document.createElement('div');
        message.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            color: #856404;
            padding: 12px 16px;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            z-index: 10000;
            font-family: system-ui, sans-serif;
            font-size: 14px;
            max-width: 300px;
        `;
        message.innerHTML = `
            <div>맞춤법 검사를 위해 API 키 설정이 필요합니다.</div>
            <button onclick="this.parentElement.remove()" style="
                background: none; border: none; color: #856404;
                text-decoration: underline; cursor: pointer; margin-top: 8px;
            ">확인</button>
        `;

        document.body.appendChild(message);

        // 5초 후 자동 제거
        setTimeout(() => {
            if (message.parentElement) {
                message.remove();
            }
        }, 5000);
    }
}

// 초기화
const spellChecker = new ContentSpellChecker();
spellChecker.init();

