import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Input, Select } from '../ui-v2';

const OTHER_TOWN = 'Other – type it';
const OTHER_VALUE = '__other__';

interface TownSelectProps {
  /** The chosen state. The dropdown stays disabled until there is one. */
  state: string;
  /** The town. A value that is not in the list shows through "Other – type it". */
  value: string;
  onChange: (town: string) => void;
  /** Towns of the state. */
  towns: string[];
  /** Admin forms: the list is still loading. */
  loading?: boolean;
  label?: string;
  error?: string;
  id?: string;
  /** `v2` is the admin field (label, hint, error). `plain` is the bare native control for the public checkout, where the caller draws label and error. */
  variant?: 'v2' | 'plain';
  /** `plain` only: classes of the native select and of the typed input. */
  selectClassName?: string;
  inputClassName?: string;
  /** `v2` only: grid class of the typed input, which sits on its own row. */
  typedClassName?: string;
  controlStyle?: CSSProperties;
}

/** City/Town: a dropdown of the towns in the chosen state, with "Other – type it" as the last option. */
export function TownSelect({
  state, value, onChange, towns, loading, label = 'City/Town', error, id,
  variant = 'v2', selectClassName, inputClassName, typedClassName = 'full', controlStyle,
}: TownSelectProps) {
  const [typing, setTyping] = useState(false);
  const known = towns.find((t) => t.toLowerCase() === value.trim().toLowerCase());

  // Changing the state clears the town. A form that sets state and town together (a prefill) keeps both.
  const previous = useRef({ state, value });
  useEffect(() => {
    const was = previous.current;
    if (was.state !== state) {
      setTyping(false);
      if (was.state !== '' && value === was.value && value !== '') onChange('');
    }
    previous.current = { state, value };
  });

  const noList = !!state && !loading && towns.length === 0;
  const showInput = !!state && !loading && (noList || typing || (value !== '' && !known));
  const selected = !state ? '' : showInput ? OTHER_VALUE : known ?? '';

  const pick = (v: string) => {
    if (v === OTHER_VALUE) {
      setTyping(true);
      onChange('');
    } else {
      setTyping(false);
      onChange(v);
    }
  };

  const options = (
    <>
      <option value="">{state ? 'Choose city/town' : 'Choose a state first'}</option>
      {loading && value && <option value={value}>{value}</option>}
      {towns.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
      {!noList && <option value={OTHER_VALUE}>{OTHER_TOWN}</option>}
    </>
  );
  const disabled = !state || !!loading;
  const typed = (
    <input
      type="text"
      aria-label={`${label} (type it)`}
      placeholder="Type the city/town"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClassName}
      style={controlStyle}
      autoComplete="off"
    />
  );

  if (variant === 'plain') {
    return (
      <div className="space-y-2">
        {!noList && (
          <select
            id={id}
            aria-label={label}
            value={loading ? value : selected}
            disabled={disabled}
            onChange={(e) => pick(e.target.value)}
            className={selectClassName}
            style={controlStyle}
          >
            {options}
          </select>
        )}
        {showInput && typed}
      </div>
    );
  }

  return (
    <>
      {!noList && (
        <Select id={id} label={label} value={loading ? value : selected} disabled={disabled} onChange={(e) => pick(e.target.value)} error={showInput ? undefined : error}>
          {options}
        </Select>
      )}
      {showInput && (
        <Input
          id={noList ? id : undefined}
          label={noList ? label : `${label} (type it)`}
          className={noList ? undefined : typedClassName}
          placeholder="Type the city/town"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          error={error}
          autoComplete="off"
        />
      )}
    </>
  );
}
