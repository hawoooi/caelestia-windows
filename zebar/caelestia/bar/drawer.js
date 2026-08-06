// Verbatim from the Task 8 brief. Morphs the bar between its collapsed and
// expanded (drawer-open) states, using View Transitions when the runtime
// supports them and falling back to a direct class toggle (snap, no
// animation) otherwise -- see Task 8 report for how the fallback path was
// verified live (stubbing document.startViewTransition = undefined).
export function toggleDrawer(barEl, open) {
  const apply = () => {
    document.body.classList.toggle('drawer-open', open);
    barEl.classList.toggle('media-open', open);
  };
  if (document.startViewTransition) {
    document.startViewTransition(apply);
  } else {
    apply();   // snaps rather than morphs; still correct
  }
}
