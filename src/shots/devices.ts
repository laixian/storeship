/**
 * Device profiles: the pixel sizes App Store Connect accepts per display
 * type, and the simulator each one is shot on. ASC rejects a screenshot
 * whose pixel size is not exactly one of its accepted values.
 */
import type { Device, DeviceBody } from './types.ts'

/** Dynamic Island iPhones. The island is in the screenshot already (simctl captures it), so the body never draws one. */
const ISLAND: DeviceBody = { kind: 'island', rim: 0.014, bezel: 0.03, radius: 0.135, buttons: [['a', 0.18, 0.035], ['a', 0.25, 0.065], ['a', 0.335, 0.065], ['b', 0.28, 0.1], ['b', 0.6, 0.055]] }
/** Home-button iPhones: square screen corners, tall chin and forehead. */
const HOME: DeviceBody = { kind: 'home', rim: 0.014, bezel: 0.045, chin: 0.26, radius: 0, buttons: [['a', 0.13, 0.04], ['a', 0.2, 0.06], ['a', 0.28, 0.06], ['b', 0.2, 0.07]] }
/** Flat-edge iPads: even border, gentle screen corners. */
const IPAD: DeviceBody = { kind: 'ipad', rim: 0.008, bezel: 0.038, radius: 0.028, buttons: [['b', 0.08, 0.06], ['b', 0.16, 0.06]] }

export const DEVICES: Record<string, Device> = {
  iphone69: {
    id: 'iphone69', prefix: 'iphone', w: 1320, h: 2868, srcW: 1320, srcH: 2868, unit: 1, body: ISLAND,
    displayType: 'APP_IPHONE_67',
    sim: { name: 'iPhone 17 Pro Max', pt: [440, 956], px: 3 },
  },
  iphone67: {
    id: 'iphone67', prefix: 'iphone67', w: 1290, h: 2796, srcW: 1290, srcH: 2796, unit: 0.977, body: ISLAND,
    displayType: 'APP_IPHONE_67',
    sim: { name: 'iPhone 16 Plus', pt: [430, 932], px: 3 },
  },
  iphone63: {
    id: 'iphone63', prefix: 'iphone63', w: 1206, h: 2622, srcW: 1206, srcH: 2622, unit: 0.914, body: ISLAND,
    displayType: 'APP_IPHONE_61',
    sim: { name: 'iPhone 17 Pro', pt: [402, 874], px: 3 },
  },
  iphone65: {
    id: 'iphone65', prefix: 'iphone65', w: 1284, h: 2778, srcW: 1284, srcH: 2778, unit: 0.973, body: ISLAND,
    displayType: 'APP_IPHONE_65',
    sim: { name: 'iPhone 11 Pro Max', pt: [414, 896], px: 3 },
  },
  iphone55: {
    id: 'iphone55', prefix: 'iphone55', w: 1242, h: 2208, srcW: 1242, srcH: 2208, unit: 0.94, body: HOME,
    displayType: 'APP_IPHONE_55',
    sim: { name: 'iPhone 8 Plus', pt: [414, 736], px: 3 },
  },
  ipad13: {
    id: 'ipad13', prefix: 'ipad', w: 2064, h: 2752, srcW: 2064, srcH: 2752, unit: 1.45, body: IPAD,
    displayType: 'APP_IPAD_PRO_3GEN_129',
    sim: { name: 'iPad Pro 13-inch (M5)', pt: [1032, 1376], px: 2 },
  },
  ipad129: {
    id: 'ipad129', prefix: 'ipad129', w: 2048, h: 2732, srcW: 2048, srcH: 2732, unit: 1.44, body: IPAD,
    displayType: 'APP_IPAD_PRO_3GEN_129',
    sim: { name: 'iPad Pro (12.9-inch) (6th generation)', pt: [1024, 1366], px: 2 },
  },
  ipad11: {
    id: 'ipad11', prefix: 'ipad11', w: 1668, h: 2388, srcW: 1668, srcH: 2388, unit: 1.2, body: IPAD,
    displayType: 'APP_IPAD_PRO_3GEN_11',
    sim: { name: 'iPad Pro 11-inch (M5)', pt: [834, 1194], px: 2 },
  },
}

/** Preview (video) types that pair with a screenshot display type. */
export const PREVIEW_TYPE: Record<string, string> = {
  APP_IPHONE_67: 'IPHONE_67',
  APP_IPHONE_65: 'IPHONE_65',
  APP_IPHONE_61: 'IPHONE_61',
  APP_IPHONE_55: 'IPHONE_55',
  APP_IPAD_PRO_3GEN_129: 'IPAD_PRO_3GEN_129',
  APP_IPAD_PRO_3GEN_11: 'IPAD_PRO_3GEN_11',
}

export function mergeDevices(extra?: Record<string, Partial<Device> & { id: string }>): Record<string, Device> {
  const out: Record<string, Device> = { ...DEVICES }
  for (const [id, d] of Object.entries(extra ?? {})) {
    const base = out[id]
    if (!base && (d.w === undefined || d.h === undefined || d.displayType === undefined))
      throw new Error(`device "${id}" is new, so it needs w, h, srcW, srcH and displayType`)
    const defaults: Partial<Device> = base ?? { prefix: id, unit: 1, srcW: d.w, srcH: d.h, body: ISLAND }
    out[id] = { ...defaults, ...d, id } as Device
  }
  return out
}
