# Tileset Studio: rules for agents

## What's new window must follow main
Every change that lands on `main` (merged or pushed) with anything a user would notice must update the What's new window in the same change (purely technical or performance speed-ups don't need an entry):

- Add an entry at the **top** of `NEWS` in `js/whatsnew.js` with a **new `id`** (the date, plus `-2`, `-3` for a second release that day). A new id is what makes the window open once more for returning users; reusing the old id hides the update.
- If the newest entry is from the same unreleased batch (not yet on `main`), extend it instead of adding another.
- Mirror it in `docs/whats-new.md` (Update log, newest first), and add or update a tutorial there when a feature needs steps.
- Write for animators and artists, not developers: what changed, where to find it, how to use it.
