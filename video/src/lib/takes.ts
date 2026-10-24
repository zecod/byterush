/**
 * The two screen recordings the demo is cut from (public/takes/, see README "Record the takes"),
 * with the moments the recording script logged in each, in seconds into the file: the click on the
 * file in Chrome, and the moment the whole file was on disk. Recorded one after the other, half a
 * minute apart, on the same machine and network.
 */
export const CHROME = {
  src: "takes/a.mp4",
  click: 2.628,
  done: 223.931,
};

export const BYTERUSH = {
  src: "takes/b.mp4",
  click: 2.625,
  /** the New download window is on screen */
  asked: 5.633,
  /** "start download" clicked */
  started: 7.631,
  done: 15.917,
};

export const FILE = { name: "Sintel_Documentary_by_Ali_Boubred.avi", size: "961 MB", site: "archive.org" };
export const RECORDED = "recorded 24 Oct 2026";

/** Seconds after the click. */
export const AFTER = {
  asked: BYTERUSH.asked - BYTERUSH.click,
  started: BYTERUSH.started - BYTERUSH.click,
  byterushDone: BYTERUSH.done - BYTERUSH.click,
  chromeDone: CHROME.done - CHROME.click,
};

/** Position in a take's file, in seconds, of the moment `e` seconds after its click. */
export const inChrome = (e: number) => CHROME.click + e;
export const inByterush = (e: number) => BYTERUSH.click + e;
