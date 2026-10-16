// Free geocoding via OpenStreetMap Nominatim (max 1 request/second per their usage policy).

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

interface Hit { lat: number; lng: number; neighborhood: string | null; city: string | null; area: boolean }

async function nominatim(q: string): Promise<Hit | null> {
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
  // Local names for districts ("Altstadt", not "Old Town"); city names stay as the AI wrote them.
  const res = await fetch(url, { headers: { "User-Agent": "Spotdrop/1.0 (self-hosted personal app)", "Accept-Language": "de,en" } });
  if (!res.ok) return null;
  const hits = (await res.json()) as { lat: string; lon: string; addresstype?: string; address?: Record<string, string> }[];
  const h = hits[0];
  if (!h) return null;
  const a = h.address ?? {};
  return {
    lat: Number(h.lat),
    lng: Number(h.lon),
    // Munich: suburb = Stadtbezirksteil (e.g. "Maxvorstadt"), city_district = Stadtbezirk.
    neighborhood: a.suburb ?? a.city_district ?? a.quarter ?? a.neighbourhood ?? null,
    city: a.city ?? a.town ?? a.village ?? null,
    // Matched a whole city/district rather than the venue itself.
    area: ["city", "town", "village", "municipality", "county", "state", "country", "suburb", "city_district", "borough"].includes(h.addresstype ?? ""),
  };
}

export interface GeoInput {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Tries precise → coarse. Returns precision so the UI can show "approximate" pins. */
export function geocode(s: GeoInput): Promise<(Hit & { precise: boolean }) | null> {
  const attempts: [string, boolean][] = [];
  const join = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join(", ");
  if (s.address) attempts.push([join(s.address, s.city, s.country), true]);
  if (s.name && (s.city || s.country)) attempts.push([join(s.name, s.city, s.country), true]);
  if (s.city || s.country) attempts.push([join(s.city, s.country), false]);

  const job = chain.then(async () => {
    for (const [q, precise] of attempts) {
      try {
        const hit = await nominatim(q);
        if (hit) return { ...hit, precise: precise && !hit.area };
      } catch {
        // network trouble: skip silently, the spot just won't be on the map yet
      }
    }
    return null;
  });
  chain = job.catch(() => null);
  return job;
}

/** Neighborhood for coordinates we already have (OpenStreetMap reverse lookup, same 1 req/s budget). */
export function reverseNeighborhood(lat: number, lng: number): Promise<{ neighborhood: string | null; city: string | null } | null> {
  const job = chain.then(async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&lat=${lat}&lon=${lng}`, {
        headers: { "User-Agent": "Spotdrop/1.0 (self-hosted personal app)", "Accept-Language": "de,en" },
      });
      if (!res.ok) return null;
      const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
      return { neighborhood: a.suburb ?? a.city_district ?? a.quarter ?? a.neighbourhood ?? null, city: a.city ?? a.town ?? a.village ?? null };
    } catch {
      return null;
    }
  });
  chain = job.catch(() => null);
  return job;
}
