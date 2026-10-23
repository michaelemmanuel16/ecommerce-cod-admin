interface AvailabilitySwitchProps {
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Show the words next to the switch (the drawer does, the table row does not). */
  label?: boolean;
  disabled?: boolean;
}

/** "Available for new orders" (F-709). An unavailable partner is skipped by assignment; open orders do not move. */
export function AvailabilitySwitch({ name, checked, onChange, label = true, disabled }: AvailabilitySwitchProps) {
  return (
    // A click on the switch must not open the drawer from a table row
    <label className="sw" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={`${name} available for new orders`}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="tg" />
      {label && <span>Available</span>}
    </label>
  );
}
