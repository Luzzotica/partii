// A touch joystick: the knob follows the finger inside a ring; the value is
// -1..1 on each axis (+y down), springing back to 0 on release.
import { useRef, useState } from "react";

export interface Vec {
  x: number;
  y: number;
}

export function Stick({ label, onChange, testId }: { label: string; onChange: (v: Vec) => void; testId: string }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<Vec>({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);

  const update = (cx: number, cy: number) => {
    const r = base.current!.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (cx - (r.left + radius)) / radius;
    let y = (cy - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    setKnob({ x, y });
    onChange({ x, y });
  };
  const release = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
  };

  return (
    <div
      className="stick"
      ref={base}
      data-testid={testId}
      onPointerDown={(e) => {
        pointer.current = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => pointer.current === e.pointerId && update(e.clientX, e.clientY)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="label">{label}</span>
      <div className="knob" style={{ transform: `translate(${knob.x * 40}%, ${knob.y * 40}%)` }} />
    </div>
  );
}
