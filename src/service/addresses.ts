import { networkInterfaces } from "node:os";

export interface ServiceUrls {
  webUrl: string;
  chatUrls: string[];
}

export function resolveServiceUrls(
  host: string,
  port: number,
  addresses: string[] = listLanIpv4Addresses()
): ServiceUrls {
  const webUrl = `http://127.0.0.1:${port}/`;
  if (host !== "0.0.0.0") return { webUrl, chatUrls: [] };
  return {
    webUrl,
    chatUrls: Array.from(new Set(addresses))
      .filter((address) => address && address !== "127.0.0.1")
      .map((address) => `http://${address}:${port}/chat`),
  };
}

export function listLanIpv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}
