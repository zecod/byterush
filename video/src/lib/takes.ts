/**
 * The races the demos are cut from: two screen recordings each (public/takes/, see README "Record
 * the takes"), with the moments the recording script logged in each, in seconds into the file: the
 * click on the file in Chrome, Byterush's New download window, "start download", and the moment the
 * whole file was on disk. Each pair was recorded one after the other on the same machine and
 * network.
 */
export interface Race {
  chrome: { src: string; click: number; done: number };
  byterush: { src: string; click: number; asked: number; started: number; done: number };
  file: { name: string; size: string; site: string };
  connections: number;
  /** Both sides run this much faster until Byterush is done (1: real time). */
  realRate: number;
  /** Chrome's side runs this much faster once Byterush is done. */
  rate: number;
  recorded: string;
  /** Said under the result. */
  note?: string;
}

/** 961 MB from archive.org: the demo on the website and the README's GIF. */
export const SINTEL: Race = {
  chrome: { src: "takes/a.mp4", click: 2.628, done: 223.931 },
  byterush: { src: "takes/b.mp4", click: 2.625, asked: 5.633, started: 7.631, done: 15.917 },
  file: { name: "Sintel_Documentary_by_Ali_Boubred.avi", size: "961 MB", site: "archive.org" },
  connections: 32,
  realRate: 1,
  rate: 20,
  recorded: "recorded 24 Oct 2026",
};

/** Hetzner's 10 GiB test file from Helsinki, Finland: further away, so one connection is slower. */
export const TEN_GB_HEL: Race = {
  chrome: { src: "takes/a10hel.mp4", click: 2.628, done: 546.559 },
  byterush: { src: "takes/b10hel.mp4", click: 2.509, asked: 4.45, started: 6.443, done: 62.032 },
  file: { name: "10GB.bin", size: "10.7 GB", site: "Hetzner, Helsinki" },
  connections: 16,
  realRate: 2,
  rate: 45,
  recorded: "recorded 24 Oct 2026",
  note: "Byterush ran as fast as the recording machine's disk writes, about 190 MB/s.",
};

/** Hetzner's 10 GiB test file from Falkenstein, Germany. Byterush is held back by the recording
 * machine's disk here (about 200 MB/s), not by the server. */
export const TEN_GB_FSN: Race = {
  chrome: { src: "takes/a10fsn.mp4", click: 2.628, done: 301.775 },
  byterush: { src: "takes/b10fsn.mp4", click: 2.608, asked: 4.581, started: 6.583, done: 57.5 },
  file: { name: "10GB.bin", size: "10.7 GB", site: "Hetzner, Falkenstein" },
  connections: 16,
  realRate: 2,
  rate: 30,
  recorded: "recorded 24 Oct 2026",
  note: "Byterush ran as fast as the recording machine's disk writes, about 210 MB/s.",
};

/** Seconds after the click. */
export const after = (r: Race) => ({
  asked: r.byterush.asked - r.byterush.click,
  started: r.byterush.started - r.byterush.click,
  byterushDone: r.byterush.done - r.byterush.click,
  chromeDone: r.chrome.done - r.chrome.click,
});
