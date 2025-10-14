// popup.js - 간단한 팝업 로직
class PopupManager {
    constructor() {
        this.statusIcon = document.getElementById('status-icon');
        this.statusText = document.getElementById('status-text');
        this.statusDisplay = document.getElementById('status-display');
        this.setupForm = document.getElementById('setup-form');
        this.readyActions = document.getElementById('ready-actions');
        this.apiKeyInput = document.getElementById('api-key');
        this.saveBtn = document.getElementById('save-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.errorMsg = document.getElementById('error-msg');
        this.extensionToggle = document.getElementById('extension-toggle');

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkSetupStatus();
    }

    setupEventListeners() {
        this.saveBtn.addEventListener('click', () => this.saveApiKey());
        this.resetBtn.addEventListener('click', () => this.resetSettings());
        this.apiKeyInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveApiKey();
        });
        this.extensionToggle.addEventListener('change', (e) => this.toggleExtension(e.target.checked));
    }

    async checkSetupStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'checkSetup' });

            if (response.isSetup) {
                this.showReadyState();
                // 확장 프로그램 활성화 상태 확인
                const { extensionEnabled = true } = await chrome.storage.local.get('extensionEnabled');
                this.extensionToggle.checked = extensionEnabled;
                this.updateStatusByToggle(extensionEnabled);
            } else {
                this.showSetupState();
            }
        } catch (error) {
            this.showSetupState();
        }
    }

    showReadyState() {
        this.statusIcon.textContent = '✅';
        this.statusText.textContent = '설정 완료';
        this.statusDisplay.className = 'status ready';
        this.setupForm.classList.remove('show');
        this.readyActions.style.display = 'block';
    }

    showSetupState() {
        this.statusIcon.textContent = '⚙️';
        this.statusText.textContent = '설정 필요';
        this.statusDisplay.className = 'status setup';
        this.setupForm.classList.add('show');
        this.readyActions.style.display = 'none';
        this.apiKeyInput.focus();
    }

    async saveApiKey() {
        const apiKey = this.apiKeyInput.value.trim();

        if (!apiKey) {
            this.showError('API 키를 입력해주세요.');
            return;
        }

        this.saveBtn.textContent = '저장 중...';
        this.saveBtn.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'setApiKey',
                apiKey: apiKey
            });

            if (response.success) {
                this.showReadyState();
                this.apiKeyInput.value = '';
                this.errorMsg.textContent = '';
            } else {
                this.showError(response.error || '저장에 실패했습니다.');
            }
        } catch (error) {
            this.showError('저장 중 오류가 발생했습니다.');
        } finally {
            this.saveBtn.textContent = '저장';
            this.saveBtn.disabled = false;
        }
    }

    async resetSettings() {
        if (!confirm('설정을 초기화하시겠습니까?')) return;

        try {
            await chrome.storage.local.clear();
            this.showSetupState();
        } catch (error) {
            this.showError('초기화 중 오류가 발생했습니다.');
        }
    }

    async toggleExtension(enabled) {
        try {
            await chrome.storage.local.set({ extensionEnabled: enabled });
            this.updateStatusByToggle(enabled);

            // background에 상태 변경 알림
            chrome.runtime.sendMessage({
                action: 'toggleExtension',
                enabled: enabled
            });
        } catch (error) {
            this.showError('설정 저장 중 오류가 발생했습니다.');
            // 실패 시 이전 상태로 롤백
            this.extensionToggle.checked = !enabled;
        }
    }

    updateStatusByToggle(enabled) {
        if (enabled) {
            this.statusIcon.textContent = '✅';
            this.statusText.textContent = '활성화됨';
            this.statusDisplay.className = 'status ready';
        } else {
            this.statusIcon.textContent = '⏸️';
            this.statusText.textContent = '비활성화됨';
            this.statusDisplay.className = 'status disabled';
        }
    }

    showError(message) {
        this.errorMsg.textContent = message;
        setTimeout(() => {
            this.errorMsg.textContent = '';
        }, 3000);
    }
}

// 팝업 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});