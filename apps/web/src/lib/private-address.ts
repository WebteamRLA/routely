import { isIP } from "node:net";

/**
 * Classifying IP addresses that must never be reachable through a server-side fetch of a
 * customer-supplied URL.
 *
 * Kept as a dependency-free module rather than living inside the service that uses it: this is
 * the security-critical half of the install check, and it should be testable without dragging
 * in the database client and environment validation that a service import brings with it.
 */

/**
 * True for loopback, link-local (which includes the cloud metadata address), private ranges,
 * CGNAT, benchmarking, multicast and reserved space.
 *
 * IPv4-mapped IPv6 is unwrapped first, so `::ffff:127.0.0.1` cannot slip past as an opaque v6
 * address. Anything unparseable is reported as private — for a guard, refusing what it cannot
 * understand is the only safe default.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;

  if (family === 6) {
    const groups = expandIpv6(address);
    if (!groups) return true;

    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
    const embedded = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    const highZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

    // IPv4-mapped (::ffff:a.b.c.d, in either dotted or hex spelling — `new URL` rewrites
    // `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`) and the deprecated IPv4-compatible form
    // (::a.b.c.d, which also covers :: and ::1) carry an IPv4 address that decides the answer.
    if (highZero && (g5 === 0xffff || g5 === 0)) {
      if (g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
      return isPrivateAddress(embedded);
    }
    // NAT64 (64:ff9b::/96) reaches the embedded IPv4 address through a translator.
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return isPrivateAddress(embedded);
    }

    // fc00::/7 (unique local), fe80::/10 (link-local), ff00::/8 (multicast).
    return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00;
  }

  const [a = 0, b = 0] = address.split(".").map(Number);

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved

  return false;
}

/** Eight 16-bit groups of an IPv6 address (dotted IPv4 tail allowed), or null if malformed. */
function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0] ?? "";

  // A dotted IPv4 tail becomes two hex groups.
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const values = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return values.some(Number.isNaN) ? null : values;
}
