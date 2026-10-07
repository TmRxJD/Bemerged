import type { ModuleType } from './types'

export type TemplateLike = {
  id: string
  type: ModuleType
}

export const COMMON_TEMPLATES: TemplateLike[] = [
  { id: 'EC_C', type: 'Cannon' },
  { id: 'MC_C', type: 'Cannon' },
  { id: 'EB', type: 'Armor' },
  { id: 'MB', type: 'Armor' },
  { id: 'MC_G', type: 'Generator' },
  { id: 'EC_G', type: 'Generator' },
  { id: 'EC_CO', type: 'Core' },
  { id: 'MC_CO', type: 'Core' },
]

export const RARE_TEMPLATES: TemplateLike[] = [
  { id: 'OB', type: 'Cannon' },
  { id: 'RB', type: 'Cannon' },
  { id: 'BB', type: 'Cannon' },
  { id: 'SB', type: 'Cannon' },
  { id: 'NI', type: 'Armor' },
  { id: 'PC', type: 'Armor' },
  { id: 'SR', type: 'Armor' },
  { id: 'DN', type: 'Armor' },
  { id: 'SL', type: 'Generator' },
  { id: 'OS', type: 'Generator' },
  { id: 'AR', type: 'Generator' },
  { id: 'SDS', type: 'Generator' },
  { id: 'GL', type: 'Core' },
  { id: 'MS', type: 'Core' },
  { id: 'EM', type: 'Core' },
  { id: 'CS', type: 'Core' },
]

export const EPIC_TEMPLATES: TemplateLike[] = [
  { id: 'AD', type: 'Cannon' },
  { id: 'AS', type: 'Cannon' },
  { id: 'BA', type: 'Cannon' },
  { id: 'DP', type: 'Cannon' },
  { id: 'HB', type: 'Cannon' },
  { id: 'SR', type: 'Cannon' },
  { id: 'ACP', type: 'Armor' },
  { id: 'NMP', type: 'Armor' },
  { id: 'OA', type: 'Armor' },
  { id: 'SD', type: 'Armor' },
  { id: 'SF', type: 'Armor' },
  { id: 'WR', type: 'Armor' },
  { id: 'BHD', type: 'Generator' },
  { id: 'GC', type: 'Generator' },
  { id: 'PF', type: 'Generator' },
  { id: 'PH', type: 'Generator' },
  { id: 'RB', type: 'Generator' },
  { id: 'SH', type: 'Generator' },
  { id: 'DC', type: 'Core' },
  { id: 'HC', type: 'Core' },
  { id: 'MH', type: 'Core' },
  { id: 'MVN', type: 'Core' },
  { id: 'OC', type: 'Core' },
  { id: 'PC', type: 'Core' },
]

export const BASE_RATES = {
  Common: 0.685,
  Rare: 0.29,
  Epic: 0.025,
}