import { Flame, Building2, Waves, HeartPulse } from 'lucide-react'

const ICONS = {
  fire: Flame,
  collapse: Building2,
  flood: Waves,
  medical: HeartPulse,
}

export function HazardIcon({ type, size = 16 }) {
  const Icon = ICONS[type] || HeartPulse
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />
}
