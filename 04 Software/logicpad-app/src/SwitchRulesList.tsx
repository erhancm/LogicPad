import { useMemo, useState } from "react";
import type { ProfileHdr, SwitchCard, SwitchConfig, SwitchGraph } from "./types";
import {
  addSimpleRule,
  graphHasCustomLogic,
  graphIsEmpty,
  listRuleCards,
  removeRuleCard,
  reorderRuleCards,
  ruleCardKind,
  ruleCardLabel,
  stemName,
  updateRuleCard,
  withGraph,
} from "./switchGraph";
import { RunningPicker, type OpenWindow } from "./RunningPicker";
import "./SwitchRulesList.css";

type ChipLook = { title: string; img?: string };

function exeKey(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").toLowerCase();
}

function bmpSrc(b64?: string): string | undefined {
  return b64 ? `data:image/bmp;base64,${b64}` : undefined;
}

function lookFromWindow(w: OpenWindow): ChipLook {
  return {
    title: w.title || stemName(w.exe || w.path),
    img: bmpSrc(w.iconBmp),
  };
}

export function SwitchRulesList(props: {
  cfg: SwitchConfig;
  graph: SwitchGraph;
  profiles: ProfileHdr[];
  busy?: boolean;
  enabled: boolean;
  highlightId: string | null;
  advancedOpen: boolean;
  onAdvancedOpen: (open: boolean) => void;
  onChange: (cfg: SwitchConfig) => void;
  onHighlight: (setProfileId: string | null) => void;
  onStatus?: (msg: string) => void;
  listWindows: () => Promise<OpenWindow[]>;
  pickProgram: () => Promise<string | null>;
}) {
  const {
    cfg,
    graph,
    profiles,
    busy,
    enabled,
    highlightId,
    advancedOpen,
    onAdvancedOpen,
    onChange,
    onHighlight,
    onStatus,
    listWindows,
    pickProgram,
  } = props;

  const cards = useMemo(() => listRuleCards(graph), [graph]);
  const empty = graphIsEmpty(graph);
  const hasCustom = graphHasCustomLogic(graph);

  const [pickOpen, setPickOpen] = useState(false);
  const [draftExe, setDraftExe] = useState<string | null>(null);
  const [draftLook, setDraftLook] = useState<ChipLook | null>(null);
  const [draftProfile, setDraftProfile] = useState(profiles[0]?.index ?? 0);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [winLoad, setWinLoad] = useState(false);
  const [winErr, setWinErr] = useState("");

  function commit(nextGraph: SwitchGraph, autoEnable = false) {
    const wasEmpty = graphIsEmpty(graph);
    let nextCfg = withGraph(cfg, nextGraph);
    if (autoEnable && wasEmpty && !nextCfg.enabled) {
      nextCfg = { ...nextCfg, enabled: true };
      onStatus?.("Auto-switch enabled");
    }
    onChange(nextCfg);
  }

  async function refreshWindows() {
    setWinLoad(true);
    setWinErr("");
    try {
      setWindows(await listWindows());
    } catch (err) {
      setWinErr(String(err));
    } finally {
      setWinLoad(false);
    }
  }

  async function openPicker() {
    setPickOpen(true);
    await refreshWindows();
  }

  function addRule() {
    if (!draftExe) return;
    commit(addSimpleRule(graph, draftExe, draftProfile), true);
    setDraftExe(null);
    setDraftLook(null);
  }

  function removeRule(cardId: string) {
    commit(removeRuleCard(graph, cardId));
    if (highlightId === cardId) onHighlight(null);
  }

  function moveRule(index: number, dir: -1 | 1) {
    commit(reorderRuleCards(graph, index, index + dir));
  }

  function profileName(index: number): string {
    return profiles.find((p) => p.index === index)?.name || `P${index + 1}`;
  }

  function conditionLabel(card: SwitchCard): string {
    if (ruleCardKind(card) === "advanced") return "Custom logic";
    if (card.match === "running") return "When running";
    return "When focused";
  }

  function iconFor(card: SwitchCard): ChipLook | undefined {
    const exe = card.programs[0];
    if (!exe) return undefined;
    const w = windows.find((x) => exeKey(x.exe || x.path) === exeKey(exe));
    if (w) return lookFromWindow(w);
    return { title: stemName(exe) };
  }

  return (
    <section className="sw-rules">
      <div className="sw-rules-head">
        <h3>Rules</h3>
        <button
          type="button"
          className={`sw-rules-advanced${advancedOpen ? " on" : ""}`}
          onClick={() => onAdvancedOpen(!advancedOpen)}
          title="Show the node graph for complex logic"
        >
          {advancedOpen ? "Hide graph" : "Advanced graph"}
          {hasCustom ? " •" : ""}
        </button>
      </div>

      {!enabled && !empty ? (
        <p className="sw-rules-off">
          <strong>Enable</strong> auto-switch above to activate these rules.
        </p>
      ) : null}

      {empty ? (
        <div className="sw-empty">
          <p className="sw-empty-lead">Switch profiles when you focus an app</p>
          <p>Pick a program, choose a profile, and LogicPad switches automatically.</p>
          <div className="sw-empty-steps">
            <div className="sw-empty-step">
              <span>1</span>
              Pick app
            </div>
            <div className="sw-empty-step">
              <span>2</span>
              Choose profile
            </div>
            <div className="sw-empty-step">
              <span>3</span>
              Leave app → restore
            </div>
          </div>
        </div>
      ) : null}

      <div className="sw-quick">
        <button
          type="button"
          className={`sw-quick-pick${draftExe ? " has-app" : ""}`}
          disabled={busy}
          onClick={() => void openPicker()}
        >
          {draftExe ? (
            <>
              <span className="sw-quick-thumb">
                {draftLook?.img ? <img src={draftLook.img} alt="" /> : stemName(draftExe).slice(0, 2).toUpperCase()}
              </span>
              <span className="sw-quick-meta">
                <strong>{draftLook?.title || stemName(draftExe)}</strong>
                <em>{draftExe}</em>
              </span>
            </>
          ) : (
            <span>Pick app…</span>
          )}
        </button>
        <select
          value={draftProfile}
          disabled={busy}
          onChange={(e) => setDraftProfile(Number(e.target.value))}
          aria-label="Profile"
        >
          {(profiles.length ? profiles : [{ index: 0, name: "P1", lightMode: 0, bright: 6, dim: 2 }]).map((p) => (
            <option key={p.index} value={p.index}>
              {p.name || `P${p.index + 1}`}
            </option>
          ))}
        </select>
        <button type="button" className="sw-quick-add" disabled={busy || !draftExe} onClick={addRule}>
          Add rule
        </button>
      </div>

      {cards.length > 0 ? (
        <ol className="sw-rule-list">
          {cards.map((card, i) => {
            const look = iconFor(card);
            const advanced = ruleCardKind(card) === "advanced";
            return (
              <li
                key={card.id}
                className={`sw-rule${highlightId === card.id ? " on" : ""}`}
                onClick={() => onHighlight(card.id)}
              >
                <div className="sw-rule-order">
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    aria-label="Move up"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRule(i, -1);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === cards.length - 1}
                    aria-label="Move down"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveRule(i, 1);
                    }}
                  >
                    ▼
                  </button>
                </div>
                <span className="sw-rule-icon">
                  {look?.img ? (
                    <img src={look.img} alt="" />
                  ) : (
                    stemName(card.programs[0] || "?").slice(0, 2).toUpperCase()
                  )}
                </span>
                <div className="sw-rule-body">
                  <strong>{ruleCardLabel(card)}</strong>
                  <em>
                    {conditionLabel(card)} → {profileName(card.profile)}
                  </em>
                </div>
                {advanced ? <span className="sw-rule-badge">Advanced</span> : null}
                {!advanced ? (
                  <label className="sw-rule-profile" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={card.profile}
                      disabled={busy}
                      onChange={(e) =>
                        commit(updateRuleCard(graph, card.id, { profile: Number(e.target.value) }))
                      }
                    >
                      {profiles.map((p) => (
                        <option key={p.index} value={p.index}>
                          {p.name || `P${p.index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  className="sw-rule-del"
                  aria-label={`Remove ${ruleCardLabel(card)}`}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRule(card.id);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      <RunningPicker
        dock={false}
        open={pickOpen}
        windows={windows}
        loading={winLoad}
        error={winErr || undefined}
        onClose={() => setPickOpen(false)}
        onPick={(w) => {
          const exe = (w.exe || w.path).replace(/^.*[\\/]/, "");
          setDraftExe(exe);
          setDraftLook(lookFromWindow(w));
          setPickOpen(false);
        }}
        onRefresh={() => void refreshWindows()}
        onBrowse={() =>
          void pickProgram().then((path) => {
            if (path) {
              const exe = path.replace(/^.*[\\/]/, "");
              setDraftExe(exe);
              setDraftLook({ title: stemName(exe) });
            }
            setPickOpen(false);
          })
        }
      />
    </section>
  );
}
