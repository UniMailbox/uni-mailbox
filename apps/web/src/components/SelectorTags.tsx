import { Check, ChevronsUpDown, X } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "../lib/utils";

export type SelectorOption = { value: string; label: string };

export interface SelectorTagsProps {
  ariaLabel: string;
  clearLabel: string;
  disabled?: boolean;
  emptyLabel: string;
  loading?: boolean;
  loadingLabel: string;
  labelledBy?: string;
  noResultsLabel: string;
  onChange: (value: string[]) => void;
  options: SelectorOption[];
  placeholder: string;
  removeLabel: (label: string) => string;
  searchLabel: string;
  value: string[];
}

export function SelectorTags({
  ariaLabel,
  clearLabel,
  disabled = false,
  emptyLabel,
  loading = false,
  loadingLabel,
  labelledBy,
  noResultsLabel,
  onChange,
  options,
  placeholder,
  removeLabel,
  searchLabel,
  value,
}: SelectorTagsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = value.flatMap((selectedValue) => {
    const option = options.find(
      (candidate) => candidate.value === selectedValue,
    );
    return option ? [option] : [];
  });
  const unavailable = disabled || loading;

  function toggle(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
    setOpen(false);
  }

  return (
    <div className="selector-tags" data-slot="selector-tags">
      {selected.length ? (
        <div
          aria-label={ariaLabel}
          className="selector-tags-values"
          role="list"
        >
          {selected.map((option) => (
            <Badge key={option.value} role="listitem" variant="secondary">
              <span>{option.label}</span>
              <Button
                aria-label={removeLabel(option.label)}
                className="-me-1 size-5 rounded-sm p-0"
                disabled={disabled}
                onClick={() =>
                  onChange(value.filter((item) => item !== option.value))
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </Badge>
          ))}
          <Button
            className="selector-tags-clear"
            disabled={disabled}
            onClick={() => onChange([])}
            size="sm"
            type="button"
            variant="ghost"
          >
            {clearLabel}
          </Button>
        </div>
      ) : (
        <span className="selector-tags-empty">{emptyLabel}</span>
      )}
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-controls={listId}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={loading ? loadingLabel : placeholder}
            aria-labelledby={loading ? undefined : labelledBy}
            className="selector-tags-trigger"
            disabled={unavailable}
            role="combobox"
            type="button"
            variant="outline"
          >
            <span>{loading ? loadingLabel : placeholder}</span>
            <ChevronsUpDown aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="selector-tags-popover p-0" sideOffset={6}>
          <Command loop>
            <CommandInput aria-label={searchLabel} placeholder={searchLabel} />
            <CommandList id={listId} role="listbox">
              <CommandEmpty>{noResultsLabel}</CommandEmpty>
              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <CommandItem
                    aria-selected={isSelected}
                    key={option.value}
                    onSelect={() => toggle(option.value)}
                    value={option.label}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        !isSelected && "selector-tags-check-hidden",
                      )}
                    />
                    <span>{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
