// The catalogue of status items the bar can show, and the pinned/dropdown
// split that decides where each one appears.
//
// Every entry is a set of PURE functions of a zebar provider-output map, so
// the whole catalogue is directly assertable in tests/js/statusIcons.test.mjs
// with hand-built fixtures and no DOM, no providers and no widget. That
// matters more here than anywhere else in this pack: these functions read
// provider fields, and this codebase has twice shipped a bug from *assuming*
// a provider field's shape (the invented `isFocused`; the layout-casing
// gap). Every field read below was confirmed LIVE over CDP against this
// machine's own zebar 3.3.1 -- see docs/zebar-bar.md, "Status icons: pinned
// or dropdown", for the recorded shapes.
//
// Deliberately NOT in this catalogue: `vesktop`. It is a notification badge
// driven by a shellExec poll with its own lifecycle (entries/vesktop.js),
// not a provider readout, and folding it in would mean this pure module
// growing a process-spawning dependency. It stays a fixed member of the
// pinned cluster.

// --- glyphs ---------------------------------------------------------------
//
// Font Awesome Free 6.x Solid codepoints, written as \uXXXX escapes rather
// than pasted PUA characters (CLAUDE.md's "Nerd Font glyphs" rule -- raw
// glyphs have been silently dropped to empty strings between drafting and
// the file write in this repo before).
//
// Rendered through the locally vendored webfont via the `fa-solid` class.
// Remember the trap `.bar-btn` had to learn: a `font:` SHORTHAND on an
// element carrying `.fa-solid` resets font-family and the icons silently
// fall back to Nerd Font's embedded Font Awesome *v4*, which still renders
// the low codepoints and only tofus the FA6-only ones -- a half-working
// cascade that does not look like a font bug.
const GLYPH = {
  wifi: '\uF1EB',           // wifi
  ethernet: '\uF796',       // ethernet
  offline: '\uE560',        // plug-circle-xmark (FA6 Free has no solid wifi-slash)
  volumeHigh: '\uF028',     // volume-high
  volumeLow: '\uF027',      // volume-low
  volumeOff: '\uF026',      // volume-off
  volumeMuted: '\uF6A9',    // volume-xmark
  batteryFull: '\uF240',    // battery-full
  batteryThreeQuarters: '\uF241',
  batteryHalf: '\uF242',
  batteryQuarter: '\uF243',
  batteryEmpty: '\uF244',
  cpu: '\uF2DB',            // microchip
  memory: '\uF538',         // memory
  disk: '\uF0A0',           // hard-drive
  unknown: '\uF128',        // question -- never expected, but better than a blank
};

// --- small shared helpers -------------------------------------------------

function pct(n) {
  return `${Math.round(n)}%`;
}

// Volume is a three-tier split driven by the actual level, PLUS an explicit
// muted check. `isMuted` is a real field on the provider's
// defaultPlaybackDevice (confirmed live) and is independent of `volume`: a
// device muted at 50% still reports volume 50, so a level-only check showed
// the loud speaker icon for a silent machine. That was a real bug in the
// previous statusIcons implementation, not a hypothetical.
export function volumeGlyph(volume, isMuted) {
  if (isMuted) return GLYPH.volumeMuted;
  if (volume <= 0) return GLYPH.volumeOff;
  if (volume <= 50) return GLYPH.volumeLow;
  return GLYPH.volumeHigh;
}

export function batteryGlyph(chargePercent) {
  if (chargePercent >= 90) return GLYPH.batteryFull;
  if (chargePercent >= 65) return GLYPH.batteryThreeQuarters;
  if (chargePercent >= 40) return GLYPH.batteryHalf;
  if (chargePercent >= 15) return GLYPH.batteryQuarter;
  return GLYPH.batteryEmpty;
}

// The disk provider reports an array of mounts; the bar only ever has room
// for one. Prefer the system drive, fall back to the first reported mount so
// a machine that names its system volume differently still shows something.
export function primaryDisk(disk) {
  const disks = disk?.disks;
  if (!Array.isArray(disks) || disks.length === 0) return null;
  return disks.find((d) => d?.mountPoint === 'C:\\') ?? disks[0];
}

// Sizes arrive pre-converted by the provider: each space object carries
// { bytes, siValue, siUnit, iecValue, iecUnit }. Using siValue/siUnit means
// no unit maths here at all -- and no chance of this module and the provider
// disagreeing about GB vs GiB.
function space(spaceObj) {
  if (!spaceObj || typeof spaceObj.siValue !== 'number') return null;
  return `${Math.round(spaceObj.siValue)} ${spaceObj.siUnit}`;
}

// --- the catalogue --------------------------------------------------------
//
// `available(out)` is what decides whether an item renders at all. It is
// separate from `value()` returning null on purpose: "the provider has not
// emitted yet" and "this machine has no such device" both need to hide the
// item, and neither should render a half-item with an empty value.
//
// The battery case is the reason this is not just a null check. On this
// desktop `createProvider({ type: 'battery' })` does not return null -- it
// REJECTS, with "No battery found." (confirmed live). A provider group turns
// that into an absent/null entry in the output map, so `available` returning
// false for a null battery is what keeps a batteryless desktop from showing
// a permanently empty battery row.
export const STATUS_ITEMS = {
  network: {
    label: 'Network',
    available: () => true,   // always meaningful: "Disconnected" is a real state
    glyph(out) {
      const iface = out?.network?.defaultInterface;
      if (!iface) return GLYPH.offline;
      return iface.type === 'ethernet' ? GLYPH.ethernet : GLYPH.wifi;
    },
    value(out) {
      const iface = out?.network?.defaultInterface;
      if (!iface) return 'Disconnected';
      return iface.friendlyName || iface.type || 'Connected';
    },
    detail(out) {
      const iface = out?.network?.defaultInterface;
      // ipv4Addresses entries carry a CIDR suffix ("192.168.31.61/24"); the
      // prefix length is noise in a one-line status row.
      const addr = iface?.ipv4Addresses?.[0];
      return addr ? String(addr).split('/')[0] : null;
    },
  },

  volume: {
    label: 'Volume',
    available: (out) => typeof out?.audio?.defaultPlaybackDevice?.volume === 'number',
    glyph(out) {
      const dev = out?.audio?.defaultPlaybackDevice;
      return volumeGlyph(dev?.volume ?? 0, Boolean(dev?.isMuted));
    },
    value(out) {
      const dev = out?.audio?.defaultPlaybackDevice;
      if (!dev) return null;
      return dev.isMuted ? 'Muted' : pct(dev.volume);
    },
    detail: (out) => out?.audio?.defaultPlaybackDevice?.name ?? null,
  },

  battery: {
    label: 'Battery',
    available: (out) => typeof out?.battery?.chargePercent === 'number',
    glyph: (out) => batteryGlyph(out?.battery?.chargePercent ?? 0),
    value: (out) => (typeof out?.battery?.chargePercent === 'number' ? pct(out.battery.chargePercent) : null),
    detail: (out) => out?.battery?.state ?? null,
  },

  cpu: {
    label: 'CPU',
    available: (out) => typeof out?.cpu?.usage === 'number',
    glyph: () => GLYPH.cpu,
    value: (out) => (typeof out?.cpu?.usage === 'number' ? pct(out.cpu.usage) : null),
    detail: (out) => (out?.cpu?.logicalCoreCount ? `${out.cpu.logicalCoreCount} threads` : null),
  },

  memory: {
    label: 'Memory',
    available: (out) => typeof out?.memory?.usage === 'number',
    glyph: () => GLYPH.memory,
    value: (out) => (typeof out?.memory?.usage === 'number' ? pct(out.memory.usage) : null),
    detail(out) {
      const m = out?.memory;
      if (!m || typeof m.usedMemory !== 'number' || typeof m.totalMemory !== 'number') return null;
      const gb = (bytes) => (bytes / 1e9).toFixed(1);
      return `${gb(m.usedMemory)} / ${gb(m.totalMemory)} GB`;
    },
  },

  disk: {
    label: 'Disk',
    available: (out) => primaryDisk(out?.disk) !== null,
    glyph: () => GLYPH.disk,
    value(out) {
      const d = primaryDisk(out?.disk);
      const free = space(d?.availableSpace);
      return free ? `${free} free` : null;
    },
    detail(out) {
      const d = primaryDisk(out?.disk);
      if (!d) return null;
      const total = space(d.totalSpace);
      return total ? `${d.mountPoint || ''} ${total}`.trim() : (d.mountPoint || null);
    },
  },
};

export const STATUS_IDS = Object.keys(STATUS_ITEMS);

// Builds the render model for one item. Returns null when the id is unknown
// or the item is not available on this machine right now -- callers filter
// nulls out rather than rendering placeholders.
export function statusRow(id, out) {
  const item = STATUS_ITEMS[id];
  if (!item) return null;
  if (!item.available(out)) return null;
  return {
    id,
    label: item.label,
    glyph: item.glyph(out) || GLYPH.unknown,
    value: item.value(out),
    detail: item.detail ? item.detail(out) : null,
  };
}

export function statusRows(ids, out) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => statusRow(id, out)).filter((row) => row !== null);
}

// --- configuration --------------------------------------------------------

// The shipped default, used when bar.config.json has no `status` block at
// all. Keeps the bar looking like it always has (network + volume in the
// pill) and puts the machine-vitals readouts behind the dropdown, where they
// cost no width and are one click away.
export const DEFAULT_STATUS_CONFIG = {
  pinned: ['network', 'volume'],
  dropdown: ['cpu', 'memory', 'disk', 'battery'],
};

// Normalises whatever is in bar.config.json into { pinned, dropdown }.
//
// Never throws and never lets a typo take the bar down -- the same
// degrade-loudly discipline parseBarConfig (entries/render.js) already
// applies to the entries array, and for the same reason: this is read at
// startup, before anything is rendered, so a throw here means an empty bar
// rather than one missing icon.
//
// An id may not appear in both lists: it would render twice, and the
// dropdown copy would silently duplicate a pinned one. Pinned wins, since
// that is the more visible intent.
export function parseStatusConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_STATUS_CONFIG };

  const clean = (list, what) => {
    if (list === undefined) return null;
    if (!Array.isArray(list)) {
      console.error(`bar.config.json: status.${what} must be an array; ignoring it`);
      return null;
    }
    return list.filter((id) => {
      if (typeof id !== 'string' || !STATUS_ITEMS[id]) {
        console.error(`bar.config.json: unknown status icon '${id}' in status.${what}`);
        return false;
      }
      return true;
    });
  };

  const pinned = clean(raw.pinned, 'pinned') ?? [...DEFAULT_STATUS_CONFIG.pinned];
  let dropdown = clean(raw.dropdown, 'dropdown') ?? [...DEFAULT_STATUS_CONFIG.dropdown];

  const pinnedSet = new Set(pinned);
  const duplicated = dropdown.filter((id) => pinnedSet.has(id));
  if (duplicated.length) {
    console.error(
      `bar.config.json: ${duplicated.join(', ')} listed in both status.pinned and status.dropdown; keeping pinned`,
    );
    dropdown = dropdown.filter((id) => !pinnedSet.has(id));
  }

  return { pinned, dropdown };
}
