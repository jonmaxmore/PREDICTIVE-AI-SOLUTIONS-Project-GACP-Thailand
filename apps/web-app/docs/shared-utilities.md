# 🌿 GACP Platform - Shared Utilities Documentation

## Overview
This document describes the shared utility modules used across the GACP Platform web application.

---

## 📦 Modules

### 1. Design Tokens (`@/lib/design-tokens.ts`)

Centralized design system values for consistent styling.

```typescript
import { colors, typography, spacing, shadows } from '@/lib/design-tokens';
```

#### Colors (23 values)
| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#1B5E20` | Primary brand color (DTAM green) |
| `primaryLight` | `#1B5E2014` | Light primary for backgrounds |
| `background` | `#F5F7FA` | Page background |
| `success` | `#22C55E` | Success states |
| `error` | `#EF4444` | Error states |
| `warning` | `#F59E0B` | Warning states |

---

### 2. Icons (`@/components/ui/icons.tsx`)

Reusable SVG icon components.

```typescript
import { PersonIcon, BuildingIcon, GroupIcon, LockIcon, EyeIcon } from '@/components/ui/icons';
```

#### Available Icons
| Icon | Props | Usage |
|------|-------|-------|
| `PersonIcon` | `color`, `size` | Individual account type |
| `BuildingIcon` | `color`, `size` | Juristic entity |
| `GroupIcon` | `color`, `size` | Community enterprise |
| `LockIcon` | `color`, `size` | Password field |
| `EyeIcon` | `open` | Password visibility toggle |

---

### 3. Thai ID Validator (`@/utils/thai-id-validator.ts`)

Validates 13-digit Thai National ID with checksum algorithm.

```typescript
import { validateThaiId, formatThaiId } from '@/utils/thai-id-validator';

// Validate ID
const result = validateThaiId('1-2345-67890-12-3');
// { isValid: true, formatted: '1-2345-67890-12-3', idType: 'INDIVIDUAL' }

// Format ID
const formatted = formatThaiId('1234567890123');
// '1-2345-67890-12-3'
```

#### Functions
| Function | Description |
|----------|-------------|
| `validateThaiId(id)` | Validates individual Thai ID |
| `validateJuristicId(id)` | Validates juristic entity ID (starts with 0) |
| `validateCommunityEnterpriseId(id)` | Validates community enterprise ID |
| `validateIdByType(id, type)` | Routes to correct validator by account type |
| `formatThaiId(id)` | Formats as X-XXXX-XXXXX-XX-X |

#### Checksum Algorithm
```
CheckDigit = (11 - (Σ digit[i] × (13-i)) % 11) % 10
```

---

### 4. Error Translator (`@/utils/error-translator.ts`)

Translates English API errors to Thai for user display.

```typescript
import { translateError } from '@/utils/error-translator';

const thaiMessage = translateError('Invalid credentials');
// 'เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง'
```

#### Supported Error Categories
- **Login errors**: Invalid credentials, account locked, etc.
- **Registration errors**: Duplicate email/phone, invalid ID format
- **Network errors**: Failed to fetch, server error
- **Validation errors**: Password too weak, invalid phone

---

## 🧪 Testing

```bash
cd apps/web-app
npm test -- --testPathPattern="utils/__tests__"
```

---

## 📝 Usage Example

```tsx
// Complete example in a form component
import { colors } from '@/lib/design-tokens';
import { LockIcon } from '@/components/ui/icons';
import { formatThaiId, validateThaiId } from '@/utils/thai-id-validator';
import { translateError } from '@/utils/error-translator';

function LoginForm() {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const validation = validateThaiId(identifier);
    if (!validation.isValid) {
      setError(validation.error);
      return;
    }
    
    try {
      await api.login(identifier);
    } catch (err) {
      setError(translateError(err.message));
    }
  };

  return (
    <input
      value={identifier}
      onChange={(e) => setIdentifier(formatThaiId(e.target.value))}
      style={{ borderColor: colors.border }}
    />
  );
}
```
