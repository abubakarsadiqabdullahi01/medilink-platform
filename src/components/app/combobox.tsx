'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Shown under the label, and searched along with it. */
  hint?: string;
}

/**
 * A select you can type into.
 *
 * Nigeria has 37 states and 774 local government areas. A plain dropdown was
 * usable while the seed carried fifteen of them and became unusable the
 * moment it carried all of them — somebody in Kano was scrolling past forty
 * entries to find their own. Filling the list created this problem, and this
 * is the other half of that fix.
 *
 * Used wherever a list can outgrow a screen. Short, fixed vocabularies — day
 * or night, approve or reject — stay a plain `Select`, because a search box
 * over four options is furniture.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Choose one',
  searchPlaceholder = 'Type to search…',
  emptyMessage = 'Nothing matches that.',
  disabled,
  id,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          // Justified and truncating: a long LGA name must not stretch the
          // control past the field beside it.
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) => {
            // cmdk searches the `value` prop, which here is a uuid. Match on
            // the label and hint instead, and prefer a prefix: typing "kan"
            // should put Kano above Sokoto, which merely contains it.
            const option = options.find((row) => row.value === itemValue);
            if (!option) return 0;
            const haystack = `${option.label} ${option.hint ?? ''}`.toLowerCase();
            const needle = search.toLowerCase().trim();
            if (!needle) return 1;
            if (option.label.toLowerCase().startsWith(needle)) return 1;
            if (haystack.includes(needle)) return 0.5;
            return 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={(next) => {
                    // Selecting the current one closes without clearing it:
                    // a toggle-to-empty here is almost always a misclick.
                    onChange(next);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4 shrink-0',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
