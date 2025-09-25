# 맞춤법 검사 수정 최적화 계획

## 📋 현재 문제점

### 문제 상황
- **수정 버튼 클릭** → 텍스트 교체 → `input` 이벤트 발생 → **API 재호출**
- 모든 빨간 wavy 줄이 **순간 사라짐** → API 응답 후 **다시 표시**
- 하나만 수정해도 **전체 텍스트 재검사** 발생

### 비효율성
```javascript
// 현재 코드 (비효율적)
inputElement.value = correctedText;
const inputEvent = new Event('input', { bubbles: true });
inputElement.dispatchEvent(inputEvent); // 👈 불필요한 API 재호출 유발
```

**결과**: 불필요한 네트워크 요청, 깜빡임 현상, 느린 반응속도

---

## 💡 최적화 솔루션: 스마트 오류 위치 재계산

### 핵심 아이디어
1. **API 재호출 방지** - input 이벤트 발생 중단
2. **수학적 위치 재계산** - 나머지 오류들의 위치를 동적 조정
3. **부분 DOM 업데이트** - 수정된 오류만 제거, 나머지는 위치 이동
4. **즉시 반응** - 네트워크 지연 없이 즉시 처리

---

## 🔧 구현 계획

### 1단계: Input 이벤트 제거
```javascript
// AS-IS (현재)
applyCorrection(errorId, suggestion, index) {
    // ... 텍스트 교체
    const inputEvent = new Event('input', { bubbles: true });
    inputElement.dispatchEvent(inputEvent); // 🔥 제거 필요
}

// TO-BE (개선)
applyCorrection(errorId, suggestion, index) {
    // ... 텍스트 교체
    // input 이벤트 발생 중단 → API 재호출 방지
    this.updateRemainingErrors(errorId, suggestion);
}
```

### 2단계: 스마트 위치 재계산 로직
```javascript
updateRemainingErrors(correctedErrorId, suggestion) {
    const correctedError = this.findErrorById(correctedErrorId);
    if (!correctedError) return;

    // 길이 변화량 계산
    const lengthDiff = suggestion.length - correctedError.original.length;

    // 현재 오류 배열에서 수정된 오류 제외 및 위치 조정
    this.currentErrors = this.currentErrors
        .filter(error => {
            const errorId = `${error.start}-${error.end}-${error.original}`;
            return errorId !== correctedErrorId; // 수정된 오류 제거
        })
        .map(error => {
            // 수정된 위치 이후의 오류들만 위치 조정
            if (error.start > correctedError.end) {
                return {
                    ...error,
                    start: error.start + lengthDiff,
                    end: error.end + lengthDiff
                };
            }
            return error; // 이전 위치는 그대로 유지
        });

    // DOM 업데이트
    this.updateErrorDisplay();
}
```

### 3단계: 개별 DOM 요소 관리
```javascript
updateErrorDisplay() {
    const inputElement = this.getCurrentInputElement();

    // 기존 오류 요소들 제거
    this.clearSpecificError(correctedErrorId);

    if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
        // 오버레이 재구성 (전체가 아닌 부분적)
        this.updateInputErrorOverlay(inputElement, this.currentErrors);
    } else {
        // ContentEditable 요소 재구성
        this.updateContentEditableErrors(inputElement, this.currentErrors);
    }
}
```

### 4단계: 효율적인 오버레이 업데이트
```javascript
updateInputErrorOverlay(element, errors) {
    // 기존 오버레이 찾기
    let overlay = element.parentNode?.querySelector('.spell-input-overlay');

    if (!overlay) {
        // 오버레이가 없으면 새로 생성
        return this.createInputErrorOverlay(element, errors);
    }

    // 기존 오버레이 내용만 업데이트
    overlay.innerHTML = '';
    this.buildOverlayContent(overlay, element.value, errors);
}
```

---

## 📊 예상 성능 개선

| 항목 | 현재 (AS-IS) | 개선 후 (TO-BE) | 개선율 |
|------|-------------|----------------|--------|
| **API 호출** | 매번 재호출 | 호출 없음 | **100% 감소** |
| **네트워크 지연** | 200-500ms | 0ms | **100% 제거** |
| **깜빡임 현상** | 발생 | 없음 | **완전 해결** |
| **CPU 사용량** | 높음 (재파싱) | 낮음 (계산만) | **70% 감소** |
| **사용자 경험** | 지연+깜빡임 | 즉시 반응 | **크게 개선** |

---

## 🧮 수학적 위치 재계산 로직

### 경우별 처리
```javascript
// 예시: "오랫만에 연락드립니다" → "오랜만에 연락드립니다"
// original: "오랫만에" (길이: 4), suggestion: "오랜만에" (길이: 4)
// lengthDiff = 4 - 4 = 0 → 위치 변화 없음

// 예시: "안녕 하세요" → "안녕하세요"
// original: "안녕 하세요" 중 " " (길이: 1), suggestion: "" (길이: 0)
// lengthDiff = 0 - 1 = -1 → 뒤의 모든 오류 위치 -1

function calculateNewPosition(error, correctedError, lengthDiff) {
    // Case 1: 수정된 오류보다 앞에 있는 경우
    if (error.end <= correctedError.start) {
        return error; // 위치 변화 없음
    }

    // Case 2: 수정된 오류와 겹치는 경우
    if (error.start < correctedError.end && error.end > correctedError.start) {
        return null; // 제거 (겹치는 오류는 재검사 필요)
    }

    // Case 3: 수정된 오류보다 뒤에 있는 경우
    if (error.start >= correctedError.end) {
        return {
            ...error,
            start: error.start + lengthDiff,
            end: error.end + lengthDiff
        };
    }

    return error;
}
```

---

## 🧪 테스트 시나리오

### 테스트 케이스 1: 단순 교체
```
입력: "오랫만에 연락드립니다. 잘못 써서 미안합니다."
오류: ["오랫만에" → "오랜만에", "써서" → "쳐서"]

수정: "오랫만에" → "오랜만에" (길이 동일)
예상: "써서" 오류 위치 변화 없음, API 호출 없음
```

### 테스트 케이스 2: 길이 변화
```
입력: "안녕 하세요. 잘 부탁합니다."
오류: [" 하세요" → "하세요", "잘 부탁" → "잘 부탁"]

수정: " 하세요" → "하세요" (길이 -1)
예상: "잘 부탁" 오류 위치 -1 이동, API 호출 없음
```

### 테스트 케이스 3: 복합 오류
```
입력: "오랫만에 연락 드려서 죄송 합니다"
오류: 3개 이상의 맞춤법 오류

수정: 첫 번째 오류 교체
예상: 나머지 2개 오류 위치 자동 조정, 깜빡임 없음
```

---

## ⚠️ 주의사항 및 예외 처리

### 1. 겹치는 오류 처리
```javascript
// 수정된 오류와 겹치는 오류는 제거
if (hasOverlap(error, correctedError)) {
    // 해당 오류는 재검사가 필요하므로 제거
    return null;
}
```

### 2. 복잡한 텍스트 변화
```javascript
// 매우 복잡한 변화의 경우 fallback
if (isTooComplexToCalculate(lengthDiff, textChange)) {
    // 안전하게 API 재호출
    return this.fallbackToApiCall(text, element);
}
```

### 3. 오류 ID 재생성
```javascript
// 위치가 변경된 오류는 새로운 ID 필요
const newErrorId = `${newStart}-${newEnd}-${error.original}`;
updateErrorElementId(oldErrorId, newErrorId);
```

---

## 🚀 구현 우선순위

### Phase 1: 기본 구현
- [ ] Input 이벤트 제거
- [ ] 기본 위치 재계산 로직
- [ ] 간단한 DOM 업데이트

### Phase 2: 최적화
- [ ] 복합 오류 처리
- [ ] 성능 최적화
- [ ] 에러 핸들링

### Phase 3: 고도화
- [ ] 복잡한 텍스트 변화 대응
- [ ] Fallback 메커니즘
- [ ] 종합 테스트

---

## 📈 기대 효과

### 사용자 경험
- ✅ **즉시 반응**: 네트워크 지연 없이 바로 수정 적용
- ✅ **깜빡임 없음**: 나머지 오류들이 사라지지 않음
- ✅ **자연스러운 흐름**: 수정 후 바로 다음 작업 가능

### 성능 개선
- ✅ **네트워크 트래픽 감소**: 불필요한 API 호출 제거
- ✅ **배터리 절약**: 모바일에서 네트워크 사용량 감소
- ✅ **서버 부하 감소**: API 서버 리소스 절약

### 개발 관점
- ✅ **코드 효율성**: 더 스마트한 로직
- ✅ **유지보수성**: 명확한 의도의 코드
- ✅ **확장성**: 다른 최적화 기법 적용 가능

이 최적화를 통해 **전문적인 맞춤법 검사 도구**의 품질을 한 단계 끌어올릴 수 있습니다! 🎯