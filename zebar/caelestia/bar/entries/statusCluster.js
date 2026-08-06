import { register, create } from './registry.js';

// Change 1 (lower-cluster restyle): Caelestia's visual language groups
// related lower-bar items onto ONE elevated rounded surface, not one boxed
// chip per icon -- the user explicitly rejected the "yasb-style separate
// chips" reading twice (see style.css's own comment on `.status-cluster`).
//
// This composes the EXISTING, still separately registered ('statusIcons',
// 'vesktop') and separately unit-tested factories via the registry's own
// `create()`, rather than duplicating statusIconParts()/pingState()'s
// logic here. statusIcons.js and vesktop.js are unchanged: they still each
// own their own DOM node and update() function; this just nests both
// inside one shared wrapper div so `.status-cluster`'s background/
// border-radius/padding in style.css reads as one container instead of
// two independent bar entries.
register('statusCluster', (ctx) => {
  const el = document.createElement('div');
  el.className = 'status-cluster';

  const statusIcons = create('statusIcons', ctx);
  const vesktop = create('vesktop', ctx);
  el.append(statusIcons.el, vesktop.el);

  return {
    el,
    update(out) {
      statusIcons.update(out);
      vesktop.update(out);
    },
  };
});
