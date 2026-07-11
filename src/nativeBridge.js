const getNativePlugin = name => window.Capacitor?.Plugins?.[name] || null;

export const isNativeApp = () => Boolean(window.Capacitor?.isNativePlatform?.());

export async function shareStock({ name, code, price, url }) {
  const text = `${name}（${code}）${price != null ? ` · ${price}` : ''}`;
  const share = getNativePlugin('Share');
  if (share?.share) return share.share({ title: 'Stock Radar', text, url, dialogTitle: '分享個股' });
  if (navigator.share) return navigator.share({ title: 'Stock Radar', text, url });
  await navigator.clipboard?.writeText(`${text}\n${url}`);
}

export async function schedulePriceAlert({ name, code, body, at }) {
  const notifications = getNativePlugin('LocalNotifications');
  if (!notifications?.schedule) return false;
  await notifications.requestPermissions();
  await notifications.schedule({ notifications: [{
    id: Math.floor(Date.now() % 2147483647),
    title: `${name}（${code}）價格提醒`,
    body,
    schedule: { at: new Date(at), allowWhileIdle: true },
  }] });
  return true;
}
