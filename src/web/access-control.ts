export interface WebRequestContext {
  remoteAddress?: string;
}

export function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

export function isChatRoute(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/") || pathname.startsWith("/api/chat/");
}
