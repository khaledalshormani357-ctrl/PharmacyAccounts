// Expiry alerts — pure helpers over getExpiryRadar() plus one optional
// local notification. expo-notifications is loaded dynamically (never a
// static import at the top of this file) so the web build and the unit-test
// build do not need the native module at import time.
import { getExpiryRadar } from './erp-database';

export interface ExpiryAlert {
  product_name: string;
  batch_number: string;
  expiry_date: string;
  days_to_expiry: number;
  quantity: number;
}

/** Batches already expired or expiring within `withinDays` (default 30). */
export function getExpiryAlerts(withinDays = 30): ExpiryAlert[] {
  return getExpiryRadar()
    .filter(item => (item.group === 'expired' || item.group === '30') && item.days_to_expiry <= withinDays)
    .map(item => ({
      product_name: item.product_name,
      batch_number: item.batch_number,
      expiry_date: item.expiry_date,
      days_to_expiry: item.days_to_expiry,
      quantity: item.quantity,
    }));
}

/** Short Arabic summary of the alerts, for a notification body or a banner. */
export function formatExpiryAlertSummary(alerts: ExpiryAlert[]): string {
  if (!alerts.length) return 'لا توجد دفعات منتهية أو قريبة الانتهاء خلال 30 يوماً.';
  const expiredCount = alerts.filter(alert => alert.days_to_expiry <= 0).length;
  const nearCount = alerts.length - expiredCount;
  const first = alerts[0];
  return `تنبيه صلاحية: ${expiredCount} دفعة منتهية و${nearCount} دفعة تنتهي خلال 30 يوماً (${alerts.length} دفعات). أقربها: ${first.product_name} — ${first.batch_number} (${first.expiry_date}).`;
}

/**
 * Schedule a single local notification summarising expiry alerts, if any.
 * Best-effort: never throws, and does nothing when there are no alerts or
 * when notification permission is not granted.
 */
export async function scheduleExpiryNotifications(): Promise<void> {
  try {
    const alerts = getExpiryAlerts();
    if (!alerts.length) return;
    // Dynamic import so this module stays usable without the native
    // notifications module (web, unit tests). The variable indirection
    // keeps the bundler/compiler from resolving it statically.
    const moduleName = 'expo-notifications';
    const Notifications = await import(moduleName);
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'تنبيه صلاحية الأدوية',
        body: formatExpiryAlertSummary(alerts),
      },
      trigger: null,
    });
  } catch {
    // Notifications are advisory only; a failure here must never break startup.
  }
}
