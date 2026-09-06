/** Small one-shot operations: register a device, look up an app by bundle id, app locales. */
import { type AscClient, ok } from './client.ts'

export async function registerDevice(c: AscClient, name: string, udid: string, platform = 'IOS'): Promise<{ id: string; name: string }> {
  const r = ok(await c.post('/v1/devices', { data: { type: 'devices', attributes: { name, platform, udid } } }), `register device ${name}`)
  return { id: r.json.data.id, name: r.json.data.attributes.name }
}

export async function findAppByBundleId(c: AscClient, bundleId: string): Promise<{ id: string; name: string; bundleId: string; sku: string } | undefined> {
  const apps = await c.all(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=5`)
  const a = apps[0]
  return a ? { id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId, sku: a.attributes.sku } : undefined
}

export async function listApps(c: AscClient): Promise<{ id: string; name: string; bundleId: string }[]> {
  return (await c.all('/v1/apps?limit=50')).map((a: any) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId }))
}

/** Locales the app has localized store info for. */
export async function appLocales(c: AscClient, appId: string): Promise<string[]> {
  const infos = await c.all(`/v1/apps/${appId}/appInfos?limit=10`)
  const locales = new Set<string>()
  for (const i of infos) for (const l of await c.all(`/v1/appInfos/${i.id}/appInfoLocalizations?limit=50`)) locales.add(l.attributes.locale)
  return [...locales]
}
