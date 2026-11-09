import { useMemo, useState } from 'react'
import { useDiscs } from '../hooks/useDiscs'
import { useBags } from '../hooks/useBags'
import { useCoursePins } from '../hooks/useCoursePins'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export function AnalyticsPage() {
  const { discs, isLoading: discsLoading } = useDiscs()
  const { bags } = useBags()
  const { holeAssignments, pins, computeDiscUsageStats } = useCoursePins()
  const [showAllDiscs, setShowAllDiscs] = useState(false)

  const usageStats = useMemo(() => {
    return computeDiscUsageStats(holeAssignments)
  }, [holeAssignments, computeDiscUsageStats])

  const discRoles = useMemo(() => {
    return discs.map(disc => {
      const s = usageStats.get(disc.id)
      let role: 'core' | 'scramble' | 'untagged' = 'untagged'
      if (s) {
        if (s.count >= 3 || s.courseCount >= 2) role = 'core'
        else role = 'scramble'
      }
      return {
        ...disc,
        role,
        usageCount: s?.count ?? 0,
        courseCount: s?.courseCount ?? 0,
      }
    })
  }, [discs, usageStats])

  const coreCount = useMemo(() => discRoles.filter(d => d.role === 'core').length, [discRoles])
  const scrambleCount = useMemo(() => discRoles.filter(d => d.role === 'scramble').length, [discRoles])
  const untaggedCount = useMemo(() => discRoles.filter(d => d.role === 'untagged').length, [discRoles])

  const typeData = useMemo(() => {
    const counts = { putter: 0, midrange: 0, fairway: 0, distance: 0, utility: 0 }
    discs.forEach(d => {
      if (d.type in counts) counts[d.type as keyof typeof counts]++
    })
    return [
      { name: 'Putter', value: counts.putter, color: 'oklch(65% 0.15 250)' },
      { name: 'Mid', value: counts.midrange, color: 'oklch(65% 0.15 145)' },
      { name: 'Fairway', value: counts.fairway, color: 'oklch(65% 0.18 55)' },
      { name: 'Driver', value: counts.distance, color: 'oklch(65% 0.2 25)' },
      { name: 'Utility', value: counts.utility, color: 'var(--utility)' },
    ].filter(d => d.value > 0)
  }, [discs])

  const bagData = useMemo(() => {
    return bags.map(bag => ({
      name: bag.name,
      discs: bag.disc_ids.length,
    }))
  }, [bags])

  const sortedUsedDiscs = useMemo(() => {
    const used = discRoles.filter(d => d.role !== 'untagged')
    return used.sort((a, b) => b.usageCount - a.usageCount)
  }, [discRoles])

  const uniqueModels = useMemo(() => {
    const names = new Set(discs.map(d => d.name.toLowerCase().trim()))
    return names.size
  }, [discs])

  if (discsLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--clr-muted)' }}>
        Loading analytics...
      </div>
    )
  }

  if (discs.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--clr-muted)' }}>
        Add discs and assign them to course holes to see your stats here.
      </div>
    )
  }

  const displayedDiscs = showAllDiscs ? sortedUsedDiscs : sortedUsedDiscs.slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>📊 Analytics</h1>

      {/* Inventory Stats */}
      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Inventory Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <StatCard label="Total Discs" value={discs.length} />
          <StatCard label="Unique Models" value={uniqueModels} />
          <StatCard label="Bag Setups" value={bags.length} />
          <StatCard label="Courses Pinned" value={pins.length} />
        </div>
      </section>

      {/* Disc Role Summary */}
      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Disc Role Breakdown</h2>
        <div style={{ background: 'var(--clr-surface)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--clr-border)' }}>
          <div style={{ display: 'flex', height: '1.5rem', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '0.75rem' }}>
            {coreCount > 0 && (
              <div
                style={{ flex: coreCount, background: 'oklch(65% 0.18 145)' }}
                title={`Core: ${coreCount}`}
              />
            )}
            {scrambleCount > 0 && (
              <div
                style={{ flex: scrambleCount, background: 'oklch(65% 0.18 55)' }}
                title={`Scramble: ${scrambleCount}`}
              />
            )}
            {untaggedCount > 0 && (
              <div
                style={{ flex: untaggedCount, background: 'var(--clr-border)' }}
                title={`Untagged: ${untaggedCount}`}
              />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '0.85rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: 'oklch(65% 0.18 145)' }}>{coreCount}</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.75rem' }}>Core</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.7rem' }}>3+ holes or 2+ courses</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: 'oklch(65% 0.18 55)' }}>{scrambleCount}</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.75rem' }}>Scramble</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.7rem' }}>1-2 holes</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: 'var(--clr-muted)' }}>{untaggedCount}</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.75rem' }}>Untagged</div>
              <div style={{ color: 'var(--clr-muted)', fontSize: '0.7rem' }}>Never assigned</div>
            </div>
          </div>
        </div>
      </section>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {/* Disc Type Breakdown */}
        {typeData.length > 0 && (
          <section>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Disc Types</h2>
            <div style={{ background: 'var(--clr-surface)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--clr-border)' }}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={typeData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {typeData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Bag Sizes */}
        {bagData.length > 0 && (
          <section>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Bag Sizes</h2>
            <div style={{ background: 'var(--clr-surface)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--clr-border)' }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={bagData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="discs" fill="var(--clr-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
      </div>

      {/* Most-Used Discs Table */}
      {sortedUsedDiscs.length > 0 && (
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Most-Used Discs</h2>
            {sortedUsedDiscs.length > 10 && (
              <button
                onClick={() => setShowAllDiscs(!showAllDiscs)}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--clr-surface2)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--clr-text)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                {showAllDiscs ? 'Show Top 10' : `Show All (${sortedUsedDiscs.length})`}
              </button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              background: 'var(--clr-surface)',
              border: '1px solid var(--clr-border)',
              borderRadius: 'var(--radius)',
              borderCollapse: 'collapse',
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--clr-border)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>Disc</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 600 }}>Brand</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }}>Holes</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }}>Courses</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }}>Role</th>
                </tr>
              </thead>
              <tbody>
                {displayedDiscs.map(disc => (
                  <tr key={disc.id} style={{ borderBottom: '1px solid var(--clr-border)' }}>
                    <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>{disc.name}</td>
                    <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: 'var(--clr-muted)' }}>{disc.manufacturer}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <TypeBadge type={disc.type} />
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600 }}>{disc.usageCount}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.9rem' }}>{disc.courseCount}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <RoleBadge role={disc.role} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sortedUsedDiscs.length === 0 && holeAssignments.length === 0 && (
        <div style={{
          background: 'var(--clr-surface)',
          padding: '2rem',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--clr-border)',
          textAlign: 'center',
          color: 'var(--clr-muted)',
        }}>
          <p style={{ margin: 0, fontSize: '0.95rem' }}>
            Assign discs to course holes in the <strong style={{ color: 'var(--clr-accent)' }}>Courses</strong> tab to see usage analytics.
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: 'var(--clr-surface)',
      padding: '1rem',
      borderRadius: 'var(--radius)',
      border: '1px solid var(--clr-border)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--clr-accent)' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--clr-muted)', marginTop: '0.25rem' }}>{label}</div>
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    putter: 'oklch(65% 0.15 250)',
    midrange: 'oklch(65% 0.15 145)',
    fairway: 'oklch(65% 0.18 55)',
    distance: 'oklch(65% 0.2 25)',
  }
  const labels: Record<string, string> = {
    putter: 'P',
    midrange: 'M',
    fairway: 'F',
    distance: 'D',
  }
  const color = colors[type] || 'var(--clr-muted)'
  const label = labels[type] || '?'
  return (
    <span style={{
      display: 'inline-block',
      width: '1.5rem',
      height: '1.5rem',
      borderRadius: '50%',
      background: color,
      color: 'white',
      fontSize: '0.7rem',
      fontWeight: 700,
      lineHeight: '1.5rem',
      textAlign: 'center',
    }}>
      {label}
    </span>
  )
}

function RoleBadge({ role }: { role: 'core' | 'scramble' | 'untagged' }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    core: { bg: 'oklch(65% 0.18 145)', text: 'white', label: 'Core' },
    scramble: { bg: 'oklch(65% 0.18 55)', text: 'white', label: 'Scramble' },
    untagged: { bg: 'var(--clr-border)', text: 'var(--clr-muted)', label: 'Untagged' },
  }
  const style = styles[role]
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.25rem 0.5rem',
      borderRadius: 'var(--radius)',
      background: style.bg,
      color: style.text,
      fontSize: '0.7rem',
      fontWeight: 600,
    }}>
      {style.label}
    </span>
  )
}
