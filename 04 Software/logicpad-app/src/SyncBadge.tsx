import type { JSX } from "react";
import type { SyncStatus } from "./syncState";
import "./SyncBadge.css";

const COPY: Record<SyncStatus, { label: string; title: string }> = {
  synced: { label: "Synced", title: "Synced — app and pad flash match" },
  unsaved: { label: "Unsaved", title: "Unsaved — Save to write the pad" },
  offline: { label: "Offline", title: "Offline — not connected" },
};

export function SyncBadge(props: { status: SyncStatus }): JSX.Element {
  const { label, title } = COPY[props.status];
  return (
    <span className={`sync-badge ${props.status}`} title={title} role="status">
      <span className="sync-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
