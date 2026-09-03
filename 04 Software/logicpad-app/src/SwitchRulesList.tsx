import { useMemo, useState } from "react";
import type { ProfileHdr, RuleWhen, SwitchCard, SwitchConfig, SwitchGraph } from "./types";
import {
  RULE_WHEN_LABELS,
  addRuleCard,
  cardWhen,
  graphIsEmpty,
  listRuleCards,
  removeRuleCard,
  reorderRuleCards,
  ruleCardLabel,
  ruleCardSummary,
  stemName,
  updateRuleCard,
  withGraph,
} from "./switchGraph";
import { RunningPicker, type OpenWindow } from "./RunningPicker";
import "./SwitchRulesList.css";

type PickTarget = { ruleId: string; field: "programs" | "andRunning" } | "draft";

function exeKey(exe: string): string {
  return exe.replace(/^.*[\\/]/, "").toLowerCase();
}

const WHEN_OPTIONS: RuleWhen[] = ["focused", "not-focused", "running", "focused-and-running"];

export function SwitchRulesList(props: {
  cfg: SwitchConfig;
  graph: SwitchGraph;
  profiles: ProfileHdr[];
  busy?: boolean;
  enabled: boolean;
  highlightId: string | null;
  rulesCompact: boolean;
  onRulesCompact: (compact: boolean) => void;
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
    rulesCompact,
    onRulesCompact,
    onChange,
    onHighlight,
    onStatus,
    listWindows,
    pickProgram,
  } = props;

  const cards = useMemo(() => listRuleCards(graph), [graph]);
  const empty = graphIsEmpty(graph);

  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const [draftWhen, setDraftWhen] = useState<RuleWhen>("focused");
  const [draftProfile, setDraftProfile] = useState(profiles[0]?.index ?? 0);
  const [draftOtherwise, setDraftOtherwise] = useState<"next" | "restore" | number>("next");
  const [draftPrograms, setDraftPrograms] = useState<string[]>([]);
  const [draftRunning, setDraftRunning] = useState<string[]>([]);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [winLoad, setWinLoad] = useState(false);
  const [winErr, setWinErr] = useState("");

  function profileName(index: number): string {
    return profiles.find((p) => p.index === index)?.name || `P${index + 1}`;
  }

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

  async function openPicker(target: PickTarget) {
    setPickTarget(target);
    await refreshWindows();
  }

  function addExeToList(list: string[], exe: string): string[] {
    const base = exe.replace(/^.*[\\/]/, "").trim();
    if (!base) return list;
    return list.some((p) => exeKey(p) === exeKey(base)) ? list : [...list, base];
  }

  function addDraftRule() {
    if (!draftPrograms.length) return;
    commit(
      addRuleCard(graph, {
        when: draftWhen,
        programs: draftPrograms,
        andRunning: draftWhen === "focused-and-running" ? draftRunning : undefined,
        profile: draftProfile,
        otherwise: draftOtherwise,
      }),
      true,
    );
    setDraftPrograms([]);
    setDraftRunning([]);
    setDraftOtherwise("next");
  }

  function addRuleProgram(cardId: string, field: "programs" | "andRunning", exe: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const list = field === "programs" ? card.programs : card.andRunning ?? [];
    commit(updateRuleCard(graph, cardId, { [field]: addExeToList(list, exe) }));
  }

  return (
    <section className={`sw-rules${rulesCompact ? " compact" : ""}`}>
      <div className="sw-rules-head">
        <h3>If / Then rules</h3>
        <button
          type="button"
          className={`sw-rules-advanced${rulesCompact ? " on" : ""}`}
          onClick={() => onRulesCompact(!rulesCompact)}
          title="Collapse the rule list to give the logic graph more space"
        >
          {rulesCompact ? "Show rules" : "Compact rules"}
        </button>
      </div>

      {!enabled && !empty ? (
        <p className="sw-rules-off">
          <strong>Enable</strong> auto-switch above to activate these rules.
        </p>
      ) : null}

      <div className="sw-rules-body">
        {empty ? (
          <div className="sw-empty">
            <p className="sw-empty-lead">If a program matches, switch profile</p>
            <p>Rules run top to bottom. First match wins. The logic graph below shows how rules compile.</p>
          </div>
        ) : null}

        {cards.length > 0 ? (
          <ol className="sw-rule-list">
            {cards.map((card, i) => (
              <RuleRow
                key={card.id}
                card={card}
                index={i}
                total={cards.length}
                profiles={profiles}
                busy={busy}
                highlighted={highlightId === card.id}
                profileName={profileName}
                onHighlight={() => onHighlight(card.id)}
                onRemove={() => {
                  commit(removeRuleCard(graph, card.id));
                  if (highlightId === card.id) onHighlight(null);
                }}
                onMove={(dir) => commit(reorderRuleCards(graph, i, i + dir))}
                onPatch={(patch) => commit(updateRuleCard(graph, card.id, patch))}
                onPick={(field) => void openPicker({ ruleId: card.id, field })}
              />
            ))}
          </ol>
        ) : null}

        <div className="sw-rule-builder">
        <p className="sw-rule-builder-title">Add rule</p>
        <div className="sw-rule-builder-row">
          <label>
            If
            <select value={draftWhen} disabled={busy} onChange={(e) => setDraftWhen(e.target.value as RuleWhen)}>
              {WHEN_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {RULE_WHEN_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
          <div className="sw-rule-chips">
            {draftPrograms.map((p) => (
              <span key={p} className="sw-chip mini">
                {stemName(p)}
                <button type="button" onClick={() => setDraftPrograms((list) => list.filter((x) => x !== p))}>
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="sw-add-win" disabled={busy} onClick={() => void openPicker("draft")}>
              + App
            </button>
          </div>
        </div>
        {draftWhen === "focused-and-running" ? (
          <div className="sw-rule-builder-row">
            <label>
              And running
              <div className="sw-rule-chips">
                {draftRunning.map((p) => (
                  <span key={p} className="sw-chip mini">
                    {stemName(p)}
                    <button type="button" onClick={() => setDraftRunning((list) => list.filter((x) => x !== p))}>
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="sw-add-win"
                  disabled={busy}
                  onClick={() => void openPicker({ ruleId: "__draft", field: "andRunning" })}
                >
                  + Process
                </button>
              </div>
            </label>
          </div>
        ) : null}
        <div className="sw-rule-builder-row">
          <label>
            Then profile
            <select value={draftProfile} disabled={busy} onChange={(e) => setDraftProfile(Number(e.target.value))}>
              {profiles.map((p) => (
                <option key={p.index} value={p.index}>
                  {p.name || `P${p.index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Else
            <select
              value={String(draftOtherwise)}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                setDraftOtherwise(v === "next" || v === "restore" ? v : Number(v));
              }}
            >
              <option value="next">Next rule / restore</option>
              <option value="restore">Restore previous</option>
              {profiles.map((p) => (
                <option key={`else-${p.index}`} value={p.index}>
                  Set {p.name || `P${p.index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sw-quick-add"
            disabled={busy || !draftPrograms.length}
            onClick={addDraftRule}
          >
            Add rule
          </button>
        </div>
        </div>
      </div>

      <RunningPicker
        dock={false}
        open={pickTarget != null}
        windows={windows}
        loading={winLoad}
        error={winErr || undefined}
        onClose={() => setPickTarget(null)}
        onPick={(w) => {
          const exe = (w.exe || w.path).replace(/^.*[\\/]/, "");
          if (pickTarget === "draft") {
            setDraftPrograms((list) => addExeToList(list, exe));
          } else if (pickTarget?.ruleId === "__draft") {
            setDraftRunning((list) => addExeToList(list, exe));
          } else if (pickTarget) {
            addRuleProgram(pickTarget.ruleId, pickTarget.field, exe);
          }
          setPickTarget(null);
        }}
        onRefresh={() => void refreshWindows()}
        onBrowse={() =>
          void pickProgram().then((path) => {
            if (!path || !pickTarget) return;
            const exe = path.replace(/^.*[\\/]/, "");
            if (pickTarget === "draft") setDraftPrograms((list) => addExeToList(list, exe));
            else if (pickTarget.ruleId === "__draft") setDraftRunning((list) => addExeToList(list, exe));
            else addRuleProgram(pickTarget.ruleId, pickTarget.field, exe);
            setPickTarget(null);
          })
        }
      />
    </section>
  );
}

function RuleRow(props: {
  card: SwitchCard;
  index: number;
  total: number;
  profiles: ProfileHdr[];
  busy?: boolean;
  highlighted: boolean;
  profileName: (i: number) => string;
  onHighlight: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onPatch: (patch: Partial<SwitchCard>) => void;
  onPick: (field: "programs" | "andRunning") => void;
}) {
  const { card, index, total, profiles, busy, highlighted, profileName, onHighlight, onRemove, onMove, onPatch, onPick } =
    props;
  const when = cardWhen(card);

  return (
    <li className={`sw-rule${highlighted ? " on" : ""}`} onClick={onHighlight}>
      <div className="sw-rule-order">
        <button type="button" disabled={busy || index === 0} aria-label="Move up" onClick={(e) => { e.stopPropagation(); onMove(-1); }}>
          ▲
        </button>
        <button type="button" disabled={busy || index === total - 1} aria-label="Move down" onClick={(e) => { e.stopPropagation(); onMove(1); }}>
          ▼
        </button>
      </div>
      <div className="sw-rule-body wide">
        <strong>{ruleCardSummary(card, profileName)}</strong>
        <em>{ruleCardLabel(card)}</em>
        <div className="sw-rule-inline" onClick={(e) => e.stopPropagation()}>
          <select value={when} disabled={busy} onChange={(e) => onPatch({ when: e.target.value as RuleWhen })}>
            {WHEN_OPTIONS.map((w) => (
              <option key={w} value={w}>
                {RULE_WHEN_LABELS[w]}
              </option>
            ))}
          </select>
          <select value={card.profile} disabled={busy} onChange={(e) => onPatch({ profile: Number(e.target.value) })}>
            {profiles.map((p) => (
              <option key={p.index} value={p.index}>
                {p.name || `P${p.index + 1}`}
              </option>
            ))}
          </select>
          <select
            value={String(card.otherwise ?? "next")}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              onPatch({ otherwise: v === "next" || v === "restore" ? v : Number(v) });
            }}
          >
            <option value="next">Else: next rule</option>
            <option value="restore">Else: restore</option>
            {profiles.map((p) => (
              <option key={`r-${p.index}`} value={p.index}>
                Else: {p.name || `P${p.index + 1}`}
              </option>
            ))}
          </select>
          <button type="button" className="sw-add-win" disabled={busy} onClick={() => onPick("programs")}>
            + App
          </button>
          {when === "focused-and-running" ? (
            <button type="button" className="sw-add-win" disabled={busy} onClick={() => onPick("andRunning")}>
              + Running
            </button>
          ) : null}
        </div>
      </div>
      <button type="button" className="sw-rule-del" aria-label="Remove rule" disabled={busy} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
        ×
      </button>
    </li>
  );
}
