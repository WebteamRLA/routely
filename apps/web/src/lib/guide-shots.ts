/**
 * Screenshots for Help & Guides, served from `public/guides/` — captured from the app itself (the
 * demo workspace, and the wizards' sample-data states), so they show the real screens. Sizes are
 * stored so the page reserves the space before an image loads.
 *
 * When a screen's design changes, re-capture its image: a guide that shows an old screen misleads
 * as much as one that names an old button.
 */

export interface Shot {
  src: string;
  alt: string;
  width: number;
  height: number;
  /**
   * A crop of a dialog: the image carries the dialog's own border and rounded corners (the corners
   * are transparent), so it is shown without a second frame.
   */
  dialog?: boolean;
}

const shot = (name: string, width: number, height: number, alt: string, dialog = false): Shot => ({
  src: `/guides/${name}.webp`,
  alt,
  width,
  height,
  dialog,
});

export const SHOTS = {
  checklist: shot("checklist", 2224, 922, "The Getting started checklist on the Dashboard"),
  newProject: shot(
    "new-project",
    1120,
    798,
    "The New project dialog with Project name and Website address",
    true,
  ),
  trackingCode: shot(
    "tracking-code",
    1360,
    1440,
    "The tracking code dialog: copy the script and paste it into the page head",
    true,
  ),
  abSetup: shot(
    "ab-setup",
    1600,
    1385,
    "A/B wizard step 1: experiment name, page URL and versions",
  ),
  splitSetup: shot("split-setup", 1600, 1385, "Split URL wizard step 1: Control and variant URLs"),
  results: shot("results", 1600, 1385, "An experiment's Results tab with a likely winner"),
  winnerDialog: shot("winner-dialog", 1120, 1044, "The Choose the winner dialog", true),
} as const;
