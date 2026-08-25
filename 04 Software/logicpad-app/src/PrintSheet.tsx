import { useEffect } from "react";
import { LEDS, LIGHT_MODES, type LaunchEntry, type PadKey, type ProfileHdr, type Snapshot } from "./types";
import { keySteps, launchOf } from "./format";
import "./print.css";

const LED_CLASS = ["off", "white", "red", "green", "blue"] as const;

function emptyKey(profile: number, index: number): PadKey {
  return { profile, index, label: "", led: 0, acts: [], text: "" };
}

function printedOn(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function ProfileCard({
  hdr,
  keys,
  launches,
  which,
  of,
}: {
  hdr: ProfileHdr;
  keys: PadKey[];
  launches: LaunchEntry[];
  which: number;
  of: number;
}) {
  return (
    <article className="print-a5">
      <header className="pc-top">
        <span className="pc-mark">LOGICPAD</span>
        <span className="pc-which">
          Profile {which} of {of}
        </span>
      </header>
      <div className="pc-device">
        <div className="pc-sel">
          <span className="pc-num">SEL</span>
          <div className="pc-title">Selector</div>
          <ul className="pc-steps">
            <li>Short: menu</li>
            <li>Hold: home</li>
          </ul>
        </div>
        <div className="pc-oled">
          <div className="pc-oled-main">
            <h1 className="pc-name">{hdr.name.trim() || `P${hdr.index + 1}`}</h1>
          </div>
          <div className="pc-oled-bar">
            <span>LogicPad</span>
            <span>{LIGHT_MODES[hdr.lightMode] ?? "Lights"}</span>
          </div>
        </div>
        {Array.from({ length: 9 }, (_, i) => {
          const key = keys[i] ?? emptyKey(hdr.index, i);
          const launch = launchOf(launches, hdr.index, i);
          const steps = keySteps(key, launch);
          const empty = steps.length === 0 && !key.label.trim();
          const title = key.label.trim() || (empty ? "Empty" : `Key ${i + 1}`);
          const led = LED_CLASS[key.led] ?? "off";
          return (
            <div key={i} className={empty ? "pc-key empty" : "pc-key"}>
              <div className="pc-key-head">
                <span className="pc-num">{i + 1}</span>
                <span
                  className={`pc-led ${led}`}
                  title={key.led ? LEDS[key.led] : undefined}
                />
              </div>
              <div className="pc-title">{title}</div>
              {steps.length ? (
                <ul className={steps.length > 6 ? "pc-steps dense" : "pc-steps"}>
                  {steps.map((s, n) => (
                    <li key={n}>{s}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <footer className="pc-foot">
        <span>Same layout as the pad</span>
        <span>{printedOn()}</span>
      </footer>
    </article>
  );
}

function NotesCard() {
  return (
    <article className="print-a5 notes">
      <header className="pc-top">
        <span className="pc-mark">LOGICPAD</span>
        <span className="pc-which">Notes</span>
      </header>
      <h2 className="pc-notes-title">Notes</h2>
      <div className="pc-notes-body">
        <p>SEL sits above key 1. The screen is to the right of SEL.</p>
        <p>Each square is a pad key, in the same place as on the device.</p>
        <p>The name is the OLED label. Lines under it are the macro, top to bottom.</p>
        <p>SEL is not a macro. Short press opens the menu. Hold returns home.</p>
      </div>
    </article>
  );
}

export function PrintDocument({
  snap,
  launches,
  profiles,
}: {
  snap: Snapshot;
  launches: LaunchEntry[];
  profiles: ProfileHdr[];
}) {
  const landscape = profiles.length > 1;
  const pages = landscape ? chunk(profiles, 2) : [profiles];
  const of = profiles.length;

  return (
    <div className={landscape ? "print-doc a4" : "print-doc a5"}>
      {pages.map((pair, pi) => (
        <section key={pi} className={landscape ? "print-page a4" : "print-page a5"}>
          {pair.map((hdr) => (
            <ProfileCard
              key={hdr.index}
              hdr={hdr}
              keys={snap.keys[hdr.index] ?? []}
              launches={launches}
              which={profiles.indexOf(hdr) + 1}
              of={of}
            />
          ))}
          {landscape && pair.length === 1 ? <NotesCard /> : null}
        </section>
      ))}
    </div>
  );
}

export function PrintOverlay({
  snap,
  launches,
  allProfiles,
  onAllProfiles,
  onClose,
  onPrint,
}: {
  snap: Snapshot;
  launches: LaunchEntry[];
  allProfiles: boolean;
  onAllProfiles: (v: boolean) => void;
  onClose: () => void;
  onPrint: () => void;
}) {
  const many = snap.profiles.length > 1;
  const profiles = allProfiles
    ? snap.profiles
    : snap.profiles.filter((p) => p.index === snap.meta.active);
  const landscape = profiles.length > 1;
  const paper = landscape
    ? "Set the printer to A4, landscape. Two profiles per sheet."
    : "Set the printer to A5, portrait. One profile per sheet.";

  useEffect(() => {
    const prev = document.getElementById("lp-print-page");
    const style = prev instanceof HTMLStyleElement ? prev : document.createElement("style");
    style.id = "lp-print-page";
    style.textContent = landscape
      ? "@page { size: A4 landscape; margin: 0; }"
      : "@page { size: A5 portrait; margin: 0; }";
    if (!prev) document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [landscape]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onPrint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrint]);

  return (
    <div className="print-overlay" role="dialog" aria-label="Print profiles">
      <div className="print-toolbar">
        <h2>Print profiles</h2>
        {many ? (
          <div className="print-mode">
            <button className={allProfiles ? "on" : ""} onClick={() => onAllProfiles(true)}>
              All profiles
            </button>
            <button className={!allProfiles ? "on" : ""} onClick={() => onAllProfiles(false)}>
              This profile
            </button>
          </div>
        ) : null}
        <p className="hint">{paper}</p>
        <div className="bar">
          <button className="primary" onClick={onPrint}>
            Print
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="print-stage">
        <PrintDocument snap={snap} launches={launches} profiles={profiles} />
      </div>
    </div>
  );
}
