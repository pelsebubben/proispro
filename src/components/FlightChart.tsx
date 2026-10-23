import { ClientDisc } from '../utils/disc'

interface FlightChartProps {
  discs: ClientDisc[]
  width?: number
  className?: string
}

function flightChartX(turn: number): number {
  return 22 + (6 - turn) * 15
}

function flightChartY(speed: number): number {
  return 270 - (speed - 1) / 13 * 240
}

function flightChartColor(type: string): string {
  const colors: Record<string, string> = {
    putter: 'oklch(65% 0.15 250)',
    midrange: 'oklch(65% 0.15 145)',
    fairway: 'oklch(65% 0.18 55)',
    distance: 'oklch(65% 0.2 25)',
    utility: 'var(--utility)',
  }
  return colors[type] || 'oklch(60% 0.1 280)'
}

export function FlightChart({ discs, className = '' }: FlightChartProps) {
  const chartData = discs.filter(d => {
    const speed = Number(d.speed)
    const turn = Number(d.turn)
    return !isNaN(speed) && !isNaN(turn) && speed >= 1 && speed <= 14
  })

  return (
    <div className={className}>
      <svg viewBox="0 0 210 280" style={{ width: '100%', height: 'auto' }}>
        {/* Zone labels */}
        <text x="67" y="9" textAnchor="middle" fontSize="5.5" fill="var(--clr-muted)" fontWeight="500">
          Overstable
        </text>
        <text x="112" y="9" textAnchor="middle" fontSize="5.5" fill="var(--clr-muted)" fontWeight="500">
          Stable
        </text>
        <text x="157" y="9" textAnchor="middle" fontSize="5.5" fill="var(--clr-muted)" fontWeight="500">
          Understable
        </text>

        {/* Turn axis ticks */}
        {[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6].map(t => (
          <text
            key={t}
            x={22 + (6 - t) * 15}
            y={20}
            textAnchor="middle"
            fontSize="3.5"
            fill="var(--clr-muted)"
          >
            {t}
          </text>
        ))}

        {/* Speed labels + horizontal grid lines */}
        {Array.from({ length: 14 }, (_, i) => i + 1).map(s => {
          const y = 270 - (s - 1) / 13 * 240
          return (
            <g key={s}>
              <text x={18} y={y + 1.5} textAnchor="middle" fontSize="3.5" fill="var(--clr-muted)">
                {s}
              </text>
              <line
                x1={22}
                y1={y}
                x2={202}
                y2={y}
                stroke="var(--clr-border)"
                strokeWidth="0.25"
                opacity="0.7"
              />
            </g>
          )
        })}

        {/* Vertical grid lines at each turn (except 0) */}
        {[6, 5, 4, 3, 2, 1, -1, -2, -3, -4, -5, -6].map(t => (
          <line
            key={t}
            x1={22 + (6 - t) * 15}
            y1={24}
            x2={22 + (6 - t) * 15}
            y2={270}
            stroke="var(--clr-border)"
            strokeWidth="0.25"
            opacity="0.7"
          />
        ))}

        {/* Dashed center line at turn=0 */}
        <line
          x1={112}
          y1={24}
          x2={112}
          y2={270}
          stroke="var(--clr-muted)"
          strokeWidth="0.7"
          strokeDasharray="2.5,2"
          opacity="0.85"
        />

        {/* Disc dots + labels */}
        {chartData.map(d => {
          const turn = Number(d.turn)
          const speed = Number(d.speed)
          const cx = flightChartX(turn)
          const cy = flightChartY(speed)
          const label = d.name.length > 9 ? d.name.slice(0, 8) + '…' : d.name
          return (
            <g key={d.id}>
              <circle
                cx={cx}
                cy={cy}
                r={5}
                fill={flightChartColor(d.type)}
                stroke="white"
                strokeWidth="0.8"
                opacity="0.9"
              >
                <title>{`${d.name} · ${d.speed}/${d.glide}/${d.turn}/${d.fade}`}</title>
              </circle>
              <text x={cx} y={cy + 9.5} textAnchor="middle" fontSize="3.5" fill="var(--clr-text)">
                {label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        fontSize: '0.75rem',
        color: 'var(--clr-muted)',
        marginTop: '0.5rem',
        justifyContent: 'center',
      }}>
        <span>
          <span style={{ color: 'oklch(65% 0.15 250)' }}>●</span> Putter
        </span>
        <span>
          <span style={{ color: 'oklch(65% 0.15 145)' }}>●</span> Mid
        </span>
        <span>
          <span style={{ color: 'oklch(65% 0.18 55)' }}>●</span> Fairway
        </span>
        <span>
          <span style={{ color: 'oklch(65% 0.2 25)' }}>●</span> Driver
        </span>
        <span>
          <span style={{ color: 'var(--utility)' }}>●</span> Utility
        </span>
      </div>
    </div>
  )
}
