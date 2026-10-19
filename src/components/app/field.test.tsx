import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Field } from './field';
import { Input } from '@/components/ui/input';

afterEach(cleanup);

describe('Field', () => {
  it('attaches the label, so the control has an accessible name', () => {
    render(
      <Field label="Phone number">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Phone number')).toBeInTheDocument();
  });

  it('ties the hint and the error to the control and marks it invalid', () => {
    render(
      <Field
        label="Phone number"
        hint="For example 0803 123 4567"
        error="Enter a Nigerian mobile number"
      >
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Phone number');
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    expect(document.getElementById(described[0]!)).toHaveTextContent('For example 0803 123 4567');
    expect(document.getElementById(described[1]!)).toHaveTextContent(
      'Enter a Nigerian mobile number',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('announces the error the moment it appears', () => {
    render(
      <Field label="Name" error="Enter your full name">
        <Input />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your full name');
  });

  it('says "required" and "optional" in words', () => {
    const { rerender } = render(
      <Field label="Reason" required>
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText(/Reason/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('(required)')).toBeInTheDocument();
    rerender(
      <Field label="Reason" optional>
        <Input />
      </Field>,
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('keeps a describedby the control already had', () => {
    render(
      <Field label="Amount" hint="In naira">
        <Input aria-describedby="elsewhere" />
      </Field>,
    );
    expect(screen.getByLabelText('Amount').getAttribute('aria-describedby')).toContain('elsewhere');
  });

  it('holds a new error back while the pointer is down, so the button does not slide away', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <Field label="Name">
          <Input />
        </Field>,
      );
      act(() => void document.dispatchEvent(new Event('pointerdown', { bubbles: true })));
      rerender(
        <Field label="Name" error="Enter your full name">
          <Input />
        </Field>,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');

      act(() => void document.dispatchEvent(new Event('pointerup', { bubbles: true })));
      act(() => void vi.advanceTimersByTime(150));
      expect(screen.getByRole('alert')).toHaveTextContent('Enter your full name');
      expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    } finally {
      vi.useRealTimers();
    }
  });
});
