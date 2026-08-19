// =============================================================================
// PANEL BOOTSTRAP -- the in-panel snippet, kept here as the record of it.
//
// This is NOT deployed. Each SMP panel holds a copy of this (with its own
// filename) as its script, and the real code lives in <profile>\caelestia\*.js
// which Deploy-Panels.ps1 writes as palette + panel concatenated. Keeping the
// in-panel snippet to one line means a code change is a file write and never
// GUI work.
//
// always_evaluate defeats SMP's include guard, so a panel reload picks up the
// newly deployed file instead of silently re-running the cached one.
//
// WHY IT IS WRITTEN DOWN. Switching a panel's script source (In-memory ->
// Package, say) warns that "your whole script will be unrecoverably lost", and
// it means it. Recovered by reading it out of SMP's editor before making that
// switch on the playlist panel; without this file the next such switch would
// destroy it with nothing to restore from.
//
// Substitute the panel's own filename for <panel>.
// =============================================================================

include(fb.ProfilePath + 'caelestia\\<panel>.js', { always_evaluate: true });
