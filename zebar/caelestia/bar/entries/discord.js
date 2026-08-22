import { register, create } from './registry.js';

// Discord's own group on the bar.
//
// Direct user feedback: "create a new group similar to how the wifi and audio
// and speedometer has their own group, make it so that the discord icon has
// its own sub-bubble and always shows".
//
// WHY IT LEFT THE STATUS CLUSTER. It used to be a fixed member of
// `.status-cluster`, sharing one elevated surface with the pinned wifi/volume
// glyphs and the system-stats chevron. That grouping said "Discord is another
// system readout", which it isn't: those glyphs are provider readouts of the
// machine's own state and are interchangeable with each other (they are driven
// by bar.config.json's `status.pinned` list), while this one is a live
// notification count for a single application, backed by its own shellExec
// poll and its own lifecycle. Caelestia's grouping rule is that one pill means
// one kind of thing, so a second kind earns a second pill rather than a
// slot in the first.
//
// It reuses `.status-cluster` for the outer surface deliberately -- the whole
// point is that it reads as a sibling of the existing group, not as a new
// species of furniture. What is new is the sub-bubble INSIDE it (see
// style.css's `.vesktop` rule), which is what gives the notification state a
// surface of its own to colour.
//
// This is a composition, not a reimplementation: the vesktop factory stays
// separately registered and separately tested, and is pulled in through the
// registry's create() exactly as statusCluster used to do. Nothing about the
// poll, the helper path or the badge logic lives here.
register('discord', (ctx) => {
  const el = document.createElement('div');
  el.className = 'status-cluster status-cluster--solo';

  const vesktop = create('vesktop', ctx);
  el.appendChild(vesktop.el);

  return {
    el,
    // The bubble is driven entirely by its own 5s poll, so there is nothing to
    // do on a provider tick -- same as the vesktop entry itself. Kept as an
    // explicit no-op rather than omitted, because render.js calls update() on
    // every entry unconditionally.
    update() {},
  };
});
