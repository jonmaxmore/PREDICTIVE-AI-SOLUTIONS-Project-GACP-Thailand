'use client';
/**
 * Form control components: NumberInput, FileInput, FileButton, MultiSelect, Radio
 */
import React, { useRef } from 'react';

// Shared option type

type SelectOption = string | { value: string; label: string };

// NumberInput

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
    label?: React.ReactNode;
    description?: React.ReactNode;
    error?: React.ReactNode;
    value?: string | number | '' | undefined;
    onChange?: (value: number | string) => void;
    leftSection?: React.ReactNode;
    [key: string]: unknown;
}

export const NumberInput = ({ label, description, error, value, onChange, min, max, step, className = '', placeholder, leftSection: _ls, ...props }: NumberInputProps) => (
    <div className="field-block">
        {label && <label className="field-label">{label}</label>}
        <input type="number" value={value ?? ''} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value === '' ? '' : Number(event.target.value))} min={min} max={max} step={step}
            placeholder={placeholder as string}
            className={`field-emphasis w-full px-4 py-2.5 ${className}`} {...props} />
        {description && <p className="field-help">{description}</p>}
        {error && <p className="field-error">{error}</p>}
    </div>
);

// FileInput

interface FileInputBaseProps {
    className?: string;
    label?: React.ReactNode;
    description?: React.ReactNode;
    error?: React.ReactNode;
    accept?: string;
    leftSection?: React.ReactNode;
    [key: string]: unknown;
}

interface FileInputSingleProps extends FileInputBaseProps {
    multiple?: false;
    value?: File | null;
    onChange?: (file: File | null) => void;
}

interface FileInputMultipleProps extends FileInputBaseProps {
    multiple: true;
    value?: File[];
    onChange?: (files: File[]) => void;
}

type FileInputProps = FileInputSingleProps | FileInputMultipleProps;

export const FileInput = ({ className = '', label, description, error, multiple, accept, onChange, leftSection: _ls, value: _v, ...props }: FileInputProps) => (
    <div className="field-block">
        {label && <label className="field-label">{label}</label>}
        <input type="file" multiple={multiple} accept={accept}
            className={`block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20 ${className}`}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const selectedFiles = event.target.files;
                if (multiple) {
                    onChange?.(selectedFiles ? Array.from(selectedFiles) : []);
                    return;
                }
                onChange?.(selectedFiles?.[0] || null);
            }} {...props} />
        {description && <p className="field-help">{description}</p>}
        {error && <p className="field-error">{error}</p>}
    </div>
);

// FileButton

interface FileButtonProps {
    children: React.ReactNode | ((props: { onClick: () => void }) => React.ReactNode);
    onChange?: (file: File | File[] | null) => void;
    accept?: string;
    multiple?: boolean;
    [key: string]: unknown;
}

export const FileButton = ({ children, onChange, accept, multiple }: FileButtonProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <input ref={inputRef} type="file" accept={accept as string} multiple={multiple as boolean} className="hidden"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange?.(multiple ? Array.from(event.target.files || []) : event.target.files?.[0] || null)} />
            {typeof children === 'function'
                ? children({ onClick: () => inputRef.current?.click() })
                : <span onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }} role="button" tabIndex={0} className="cursor-pointer">{children}</span>}
        </>
    );
};

// MultiSelect

interface MultiSelectProps {
    label?: React.ReactNode;
    data?: SelectOption[];
    value?: string[];
    onChange?: (values: string[]) => void;
    className?: string;
    [key: string]: unknown;
}

export const MultiSelect = ({ label, data = [], value = [], onChange, className = '' }: MultiSelectProps) => (
    <div className="field-block">
        {label && <label className="field-label">{label}</label>}
        <select multiple className={`field-emphasis w-full px-4 py-2.5 ${className}`}
            value={value} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(Array.from(event.target.selectedOptions, (option) => option.value))}>
            {data.map((item) => {
                const val = typeof item === 'string' ? item : item.value;
                const lbl = typeof item === 'string' ? item : item.label;
                return <option key={val} value={val}>{lbl}</option>;
            })}
        </select>
    </div>
);

// Radio + Radio.Group

interface RadioProps {
    value?: string;
    label?: React.ReactNode;
    checked?: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    name?: string;
    className?: string;
    [key: string]: unknown;
}

export const Radio = ({ value: radioValue, label, checked, onChange, name, className = '' }: RadioProps) => (
    <label className={`flex cursor-pointer items-center gap-3 ${className}`}>
        <input type="radio" name={name} value={radioValue} checked={checked} onChange={onChange}
            className="h-5 w-5 text-primary accent-primary" />
        {label && <span className="text-sm font-medium">{label}</span>}
    </label>
);

interface RadioGroupProps {
    children: React.ReactNode;
    label?: React.ReactNode;
    className?: string;
    [key: string]: unknown;
}

Radio.Group = function RadioGroup({ children, label, className = '' }: RadioGroupProps) {
    return (
        <div className={`field-block ${className}`}>
            {label && <p className="field-label">{label}</p>}
            {children}
        </div>
    );
};
