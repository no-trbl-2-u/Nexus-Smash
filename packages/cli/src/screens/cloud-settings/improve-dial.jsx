// Settings' "How hard the loop improves" (spec 59, A4): the improvement dial as four radios, each with its one-line
// explanation. It reads and writes the `Improve:` line in plan/bearings.md (GET and POST /api/improve, server/improve.mjs).
// The radios are the permission modes' pieces (.check from nexus.css, drawn round by styles/permission-mode.css); no
// new colour, motion or particle.

export const IMPROVE_CHOICES = [
  { value: 'off', label: 'Off', sub: 'The loop builds what you planned and nothing else.' },
  { value: 'gentle', label: 'Gentle', sub: 'Today\'s behaviour: it files what it finds, and you decide what happens to it.' },
  { value: 'steady', label: 'Steady', sub: 'It also fixes small things, promotes aged ideas and audits the interface.' },
  { value: 'bold', label: 'Bold', sub: 'Everything on, and the loop promotes its own stalled work. This is how nexus runs itself.' },
];

/** The position Settings shows as chosen: anything it does not list reads as Gentle, as the resolver does. */
export function shownPosition(value) {
  return IMPROVE_CHOICES.some((c) => c.value === value) ? value : 'gentle';
}

export function ImproveDial({ value, onChange, name = 'improve-dial', disabled = false }) {
  const v = shownPosition(value);
  return (
    <div className="perm-modes">
      <div className="perm-list" role="radiogroup" aria-label="How hard the loop improves">
        {IMPROVE_CHOICES.map((c) => (
          <label key={c.value} className="check perm-opt">
            <input type="radio" name={name} value={c.value} checked={v === c.value} disabled={disabled} onChange={() => onChange?.(c.value)} />
            <span className="perm-dot" />
            <span className="check-text">
              <span className="check-title">{c.label}{c.value === 'gentle' ? <> <span className="badge-def">default</span></> : null}</span>
              <span className="check-sub">{c.sub}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
