/**
 * versionService — Fetches app configuration (min required version,
 * maintenance mode, store URLs) from the backend app_config table.
 */
import { getSupabaseClient } from '@/template';

export interface AppConfig {
  minRequiredVersion: string;
  appStoreUrl: string;
  playStoreUrl: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
}

const DEFAULT_CONFIG: AppConfig = {
  minRequiredVersion: '1.0.0',
  appStoreUrl: 'https://apps.apple.com',
  playStoreUrl: 'https://play.google.com',
  maintenanceMode: false,
  maintenanceMessage: 'We are performing scheduled maintenance. Please try again shortly.',
};

/**
 * Fetches all app_config rows and returns a typed AppConfig object.
 * Returns defaults on any error (fail-open: don't block users on network issues).
 */
export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value');

    if (error || !data) return DEFAULT_CONFIG;

    const map: Record<string, string> = {};
    data.forEach((row: { key: string; value: string }) => {
      map[row.key] = row.value;
    });

    return {
      minRequiredVersion: map['min_required_version'] ?? DEFAULT_CONFIG.minRequiredVersion,
      appStoreUrl:        map['app_store_url']        ?? DEFAULT_CONFIG.appStoreUrl,
      playStoreUrl:       map['play_store_url']       ?? DEFAULT_CONFIG.playStoreUrl,
      maintenanceMode:    map['maintenance_mode']     === 'true',
      maintenanceMessage: map['maintenance_message']  ?? DEFAULT_CONFIG.maintenanceMessage,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Compares two semver strings (e.g. "1.2.3" vs "1.1.0").
 * Returns:
 *   1  if v1 > v2
 *   0  if v1 === v2
 *  -1  if v1 < v2
 */
export function compareVersions(v1: string, v2: string): number {
  const normalize = (v: string) =>
    v.replace(/[^0-9.]/g, '').split('.').map(Number);

  const parts1 = normalize(v1);
  const parts2 = normalize(v2);
  const len = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}
