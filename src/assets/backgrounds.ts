import AlienShip from './backgrounds/AlienShip_channel.png'
import Aurora from './backgrounds/Aurora_channel.png'
import Autumn from './backgrounds/Autumn_channel.png'
import BlueCircuit from './backgrounds/BlueCircuit.png'
import CherryBlossom from './backgrounds/CherryBlossom_channel.png'
import CherryBlossomTop from './backgrounds/CherryBlossomTop.png'
import ClockTower from './backgrounds/ClockTower.png'
import Cobweb from './backgrounds/Cobweb_channel.png'
import Cthulhu from './backgrounds/Cthulhu.png'
import DarkBeing from './backgrounds/DarkBeing.png'
import DarkStrands from './backgrounds/DarkStrands_channel.png'
import DeepBlueSea from './backgrounds/DeepBlueSea_channel.png'
import FasterThanLight from './backgrounds/FasterThanLight_channel.png'
import ForestOfCats from './backgrounds/ForestOfCats.png'
import Golden from './backgrounds/Golden_channel.png'
import Guilds from './backgrounds/Guilds.png'
import Halloween from './backgrounds/Halloween_channel.png'
import Honeycomb from './backgrounds/Honeycomb_channel.png'
import Honeymask from './backgrounds/Honeymask.png'
import HowlingWolf from './backgrounds/HowlingWolf_channel.png'
import HowlingWolf2 from './backgrounds/HowlingWolf2_channel.png'
import IntoTheStorm from './backgrounds/IntoTheStorm_channel.png'
import Invaders from './backgrounds/Invaders_channel.png'
import Matrix from './backgrounds/Matrix_channel.png'
import Matrix2 from './backgrounds/Matrix2_channel.png'
import Nebula from './backgrounds/Nebula.png'
import NewYears from './backgrounds/NewYears_channel.png'
import OceanNight from './backgrounds/OceanNight_channel.png'
import PerlinNoise from './backgrounds/PerlinNoise.png'
import Plasma from './backgrounds/Plasma_channel.png'
import PrismaticLines from './backgrounds/PrismaticLines_channel.png'
import Rainfall from './backgrounds/Rainfall_channel.png'
import ReptileIris from './backgrounds/ReptileIris.png'
import RetroArcade from './backgrounds/RetroArcade_channel.png'
import Retrowave from './backgrounds/Retrowave_channel.png'
import SandsOfTime from './backgrounds/SandsOfTme_channel.png'
import Stars from './backgrounds/Stars.png'
import SunsetFishing from './backgrounds/SunsetFishing_channel.png'
import Virus from './backgrounds/Virus_channel.png'

export const BACKGROUNDS = {
  AlienShip,
  Aurora,
  Autumn,
  BlueCircuit,
  CherryBlossom,
  CherryBlossomTop,
  ClockTower,
  Cobweb,
  Cthulhu,
  DarkBeing,
  DarkStrands,
  DeepBlueSea,
  FasterThanLight,
  ForestOfCats,
  Golden,
  Guilds,
  Halloween,
  Honeycomb,
  Honeymask,
  HowlingWolf,
  HowlingWolf2,
  IntoTheStorm,
  Invaders,
  Matrix,
  Matrix2,
  Nebula,
  NewYears,
  OceanNight,
  PerlinNoise,
  Plasma,
  PrismaticLines,
  Rainfall,
  ReptileIris,
  RetroArcade,
  Retrowave,
  SandsOfTime,
  Stars,
  SunsetFishing,
  Virus,
}

export type BackgroundKey = keyof typeof BACKGROUNDS

export function formatBackgroundDisplay(key: string): string {
  if (!key) return 'None'
  return String(key)
    .replace(/_channel$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
}

export function applyBackground(key?: BackgroundKey | null) {
  const html = document.documentElement
  const body = document.body

  const clearBackground = () => {
    html.style.backgroundImage = ''
    html.style.backgroundSize = ''
    html.style.backgroundPosition = ''
    html.style.backgroundRepeat = ''
    html.style.backgroundAttachment = ''
    html.style.backgroundColor = '#000'
    html.style.height = '100%'
    html.style.minHeight = '100vh'
    body.style.backgroundImage = ''
    body.style.backgroundSize = ''
    body.style.backgroundPosition = ''
    body.style.backgroundRepeat = ''
    body.style.backgroundAttachment = ''
    body.style.backgroundColor = 'transparent'
    body.style.height = '100%'
    body.style.minHeight = '100vh'
  }

  if (!key) {
    clearBackground()
    return
  }
  const url = BACKGROUNDS[key]
  if (!url) {
    clearBackground()
    return
  }

  html.style.height = '100%'
  html.style.minHeight = '100vh'
  body.style.height = '100%'
  body.style.minHeight = '100vh'

  html.style.backgroundColor = '#000'
  html.style.backgroundImage = ''
  html.style.backgroundSize = ''
  html.style.backgroundPosition = ''
  html.style.backgroundRepeat = ''
  html.style.backgroundAttachment = ''

  body.style.backgroundImage = `url("${url}")`
  body.style.backgroundSize = 'cover'
  body.style.backgroundPosition = 'center center'
  body.style.backgroundRepeat = 'no-repeat'
  body.style.backgroundAttachment = 'scroll'
  body.style.backgroundColor = 'transparent'
  localStorage.setItem('background', key)
}

export default BACKGROUNDS
