/**
 * @jest-environment jsdom
 * 
 * DOM Test Example: Button Component
 * Tests rendering, user interactions, and accessibility
 */
import React from 'react';
import { render, screen, fireEvent } from '@/__tests__/test-utils';
import '@testing-library/jest-dom';

// Simple Button component for testing (can be replaced with actual component)
interface ButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: 'primary' | 'secondary' | 'danger';
    type?: 'button' | 'submit' | 'reset';
    loading?: boolean;
}

const Button: React.FC<ButtonProps> = ({ 
    children, 
    onClick, 
    disabled = false, 
    variant = 'primary',
    type = 'button',
    loading = false,
}) => {
    const baseStyles = 'px-4 py-2 rounded font-medium transition-colors';
    const variantStyles = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300',
        danger: 'bg-red-600 text-white hover:bg-red-700',
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled || loading}
            className={`${baseStyles} ${variantStyles[variant]} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            data-testid="button"
        >
            {loading ? 'กำลังโหลด...' : children}
        </button>
    );
};

describe('Button Component (DOM Tests)', () => {
    // Test 1: Basic rendering
    it('renders button with text', () => {
        render(<Button>คลิกที่นี่</Button>);
        
        const button = screen.getByTestId('button');
        expect(button).toBeInTheDocument();
        expect(button).toHaveTextContent('คลิกที่นี่');
    });

    // Test 2: Click handling
    it('calls onClick when clicked', () => {
        const handleClick = jest.fn();
        render(<Button onClick={handleClick}>คลิก</Button>);
        
        const button = screen.getByTestId('button');
        fireEvent.click(button);
        
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    // Test 3: Disabled state
    it('is disabled when disabled prop is true', () => {
        render(<Button disabled>ปิดใช้งาน</Button>);
        
        const button = screen.getByTestId('button');
        expect(button).toBeDisabled();
        expect(button).toHaveClass('opacity-50', 'cursor-not-allowed');
    });

    // Test 4: Does not call onClick when disabled
    it('does not call onClick when disabled', () => {
        const handleClick = jest.fn();
        render(<Button onClick={handleClick} disabled>ปิดใช้งาน</Button>);
        
        const button = screen.getByTestId('button');
        fireEvent.click(button);
        
        expect(handleClick).not.toHaveBeenCalled();
    });

    // Test 5: Loading state
    it('shows loading text when loading', () => {
        render(<Button loading>บันทึก</Button>);
        
        const button = screen.getByTestId('button');
        expect(button).toHaveTextContent('กำลังโหลด...');
        expect(button).toBeDisabled();
    });

    // Test 6: Variants styling
    it('applies correct variant styles', () => {
        const { rerender } = render(<Button variant="primary">Primary</Button>);
        expect(screen.getByTestId('button')).toHaveClass('bg-blue-600');

        rerender(<Button variant="secondary">Secondary</Button>);
        expect(screen.getByTestId('button')).toHaveClass('bg-gray-200');

        rerender(<Button variant="danger">Danger</Button>);
        expect(screen.getByTestId('button')).toHaveClass('bg-red-600');
    });

    // Test 7: Button types
    it('has correct button type attribute', () => {
        const { rerender } = render(<Button type="button">Button</Button>);
        expect(screen.getByTestId('button')).toHaveAttribute('type', 'button');

        rerender(<Button type="submit">Submit</Button>);
        expect(screen.getByTestId('button')).toHaveAttribute('type', 'submit');

        rerender(<Button type="reset">Reset</Button>);
        expect(screen.getByTestId('button')).toHaveAttribute('type', 'reset');
    });

    // Test 8: Accessibility - can be focused
    it('can be focused when not disabled', () => {
        render(<Button>Focusable</Button>);
        
        const button = screen.getByTestId('button');
        button.focus();
        
        expect(button).toHaveFocus();
    });

    // Test 9: Thai language content
    it('renders Thai text correctly', () => {
        render(<Button>สมัครสมาชิก</Button>);
        
        expect(screen.getByText('สมัครสมาชิก')).toBeInTheDocument();
    });
});
