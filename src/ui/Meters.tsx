// Control and Trust, as two thin bars.
//
// Colour bands come from one helper so the bar and the number always agree:
// green above 60, amber between 30 and 60, red below 30. Width is a CSS
// transition, so a meter hit slides rather than jumps.

export type MetersProps = {
  control: number
  trust: number
}

function band(value: number): 'good' | 'warn' | 'bad' {
  if (value > 60) return 'good'
  if (value >= 30) return 'warn'
  return 'bad'
}

function Meter({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="meter" data-meter={label.toLowerCase()}>
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{clamped}</span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="meter-fill" data-band={band(clamped)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

export function Meters({ control, trust }: MetersProps) {
  return (
    <div className="meters">
      <Meter label="CONTROL" value={control} />
      <Meter label="TRUST" value={trust} />
    </div>
  )
}
