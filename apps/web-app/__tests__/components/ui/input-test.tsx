/**
 * @jest-environment jsdom
 * 
 * DOM Test Example: Input Component
 * Tests form inputs, validation, and user interactions
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@/__tests__/test-utils';
import '@testing-library/jest-dom';

interface InputProps {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    error?: string;
    disabled?: boolean;
    type?: 'text' | 'password' | 'email' | 'number';
    required?: boolean;
    'data-testid'?: string;
}

const Input: React.FC<InputProps> = ({
    label,
    value,
    onChange,
    placeholder,
    error,
    disabled = false,
    type = 'text',
    required = false,
    'data-testid': dataTestId = 'input',
}) => {
    return (
        <div className="mb-4">
            {label && (
                <label className="mb-1 block text-sm font-medium" htmlFor={dataTestId}>
                    {label}
                    {required && <span className="text-red-500">*</span>}
                </label>
            )}
            <input
                id={dataTestId}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className={`w-full rounded border px-3 py-2 ${
                    error ? 'border-red-500' : 'border-gray-300'
                } ${disabled ? 'bg-gray-100' : ''}`}
                data-testid={dataTestId}
            />
            {error && (
                <span className="mt-1 text-sm text-red-500" data-testid={`${dataTestId}-error`}>
                    {error}
                </span>
            )}
        </div>
    );
};

// Form wrapper for testing
const TestForm: React.FC = () => {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    const handleChange = (newValue: string) => {
        setValue(newValue);
        if (newValue.length < 3 && newValue.length > 0) {
            setError('ต้องมีอย่างน้อย 3 ตัวอักษร');
        } else {
            setError('');
        }
    };

    return (
        <Input
            label="ชื่อผู้ใช้"
            value={value}
            onChange={handleChange}
            placeholder="กรอกชื่อผู้ใช้"
            error={error}
            required
            data-testid="username-input"
        />
    );
};

describe('Input Component (DOM Tests)', () => {
    it('renders input with label', () => {
        render(<TestForm />);
        
        expect(screen.getByLabelText(/ชื่อผู้ใช้/i)).toBeInTheDocument();
        expect(screen.getByTestId('username-input')).toBeInTheDocument();
    });

    it('shows required indicator', () => {
        render(<TestForm />);
        
        const label = screen.getByText('ชื่อผู้ใช้');
        expect(label.nextSibling).toHaveTextContent('*');
    });

    it('updates value on change', () => {
        render(<TestForm />);
        
        const input = screen.getByTestId('username-input');
        fireEvent.change(input, { target: { value: 'สมชาย' } });
        
        expect(input).toHaveValue('สมชาย');
    });

    it('shows error message for invalid input', async () => {
        render(<TestForm />);
        
        const input = screen.getByTestId('username-input');
        fireEvent.change(input, { target: { value: 'ab' } });
        
        await waitFor(() => {
            expect(screen.getByTestId('username-input-error')).toBeInTheDocument();
            expect(screen.getByText('ต้องมีอย่างน้อย 3 ตัวอักษร')).toBeInTheDocument();
        });
    });

    it('applies error styling when error exists', async () => {
        render(<TestForm />);
        
        const input = screen.getByTestId('username-input');
        fireEvent.change(input, { target: { value: 'ab' } });
        
        await waitFor(() => {
            expect(input).toHaveClass('border-red-500');
        });
    });

    it('accepts Thai characters', () => {
        render(<TestForm />);
        
        const input = screen.getByTestId('username-input');
        fireEvent.change(input, { target: { value: 'สมชายใจดีมาก' } });
        
        expect(input).toHaveValue('สมชายใจดีมาก');
    });

    it('is disabled when disabled prop is true', () => {
        render(
            <Input
                value=""
                onChange={() => {}}
                disabled
                data-testid="disabled-input"
            />
        );
        
        expect(screen.getByTestId('disabled-input')).toBeDisabled();
    });

    it('shows placeholder text', () => {
        render(
            <Input
                value=""
                onChange={() => {}}
                placeholder="กรอกข้อมูล"
                data-testid="placeholder-input"
            />
        );
        
        expect(screen.getByPlaceholderText('กรอกข้อมูล')).toBeInTheDocument();
    });

    it('supports different input types', () => {
        const { rerender } = render(
            <Input
                value=""
                onChange={() => {}}
                type="text"
                data-testid="type-input"
            />
        );
        expect(screen.getByTestId('type-input')).toHaveAttribute('type', 'text');

        rerender(
            <Input
                value=""
                onChange={() => {}}
                type="password"
                data-testid="type-input"
            />
        );
        expect(screen.getByTestId('type-input')).toHaveAttribute('type', 'password');

        rerender(
            <Input
                value=""
                onChange={() => {}}
                type="email"
                data-testid="type-input"
            />
        );
        expect(screen.getByTestId('type-input')).toHaveAttribute('type', 'email');
    });
});
