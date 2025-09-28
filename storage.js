// storage.js - 간단한 API 키 관리
class ApiKeyStorage {
    static async get() {
        const result = await chrome.storage.local.get(['apiKey']);
        return result.apiKey || null;
    }

    static async set(key) {
        await chrome.storage.local.set({
            apiKey: btoa(key), // 간단한 Base64 인코딩
            setupDone: true
        });
    }

    static async isSetup() {
        const result = await chrome.storage.local.get(['setupDone']);
        return !!result.setupDone;
    }

    static decode(encoded) {
        try {
            return atob(encoded);
        } catch {
            return null;
        }
    }

    static async getDecoded() {
        const encoded = await this.get();
        return encoded ? this.decode(encoded) : null;
    }

    static async clear() {
        await chrome.storage.local.remove(['apiKey', 'setupDone']);
    }
}