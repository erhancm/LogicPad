//! Node-graph auto-switch: conditions wire into prioritized profile actions.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchGraph {
    #[serde(default)]
    pub nodes: Vec<GraphNode>,
    #[serde(default)]
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GraphNode {
    Foreground {
        id: String,
        x: f64,
        y: f64,
        #[serde(default)]
        programs: Vec<String>,
    },
    Running {
        id: String,
        x: f64,
        y: f64,
        #[serde(default)]
        programs: Vec<String>,
    },
    And {
        id: String,
        x: f64,
        y: f64,
    },
    Or {
        id: String,
        x: f64,
        y: f64,
    },
    SetProfile {
        id: String,
        x: f64,
        y: f64,
        profile: u8,
        #[serde(default)]
        priority: u8,
        #[serde(default, rename = "lightMode")]
        light_mode: Option<u8>,
        #[serde(default)]
        bright: Option<u8>,
        #[serde(default)]
        dim: Option<u8>,
        #[serde(default)]
        leds: Option<Vec<u8>>,
    },
    Restore {
        id: String,
        x: f64,
        y: f64,
        #[serde(default)]
        priority: u8,
    },
}

impl GraphNode {
    pub fn id(&self) -> &str {
        match self {
            GraphNode::Foreground { id, .. }
            | GraphNode::Running { id, .. }
            | GraphNode::And { id, .. }
            | GraphNode::Or { id, .. }
            | GraphNode::SetProfile { id, .. }
            | GraphNode::Restore { id, .. } => id,
        }
    }

    fn priority(&self) -> Option<u8> {
        match self {
            GraphNode::SetProfile { priority, .. } | GraphNode::Restore { priority, .. } => {
                Some(*priority)
            }
            _ => None,
        }
    }
}

pub fn exe_basename(path: &str) -> String {
    Path::new(path.trim())
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path.trim())
        .to_string()
}

pub fn exe_stem(path: &str) -> String {
    let b = exe_basename(path).to_ascii_lowercase();
    b.strip_suffix(".exe").unwrap_or(&b).to_string()
}

/// True when evaluation needs a full window list (not just the foreground exe).
pub fn uses_running(graph: &SwitchGraph) -> bool {
    graph
        .nodes
        .iter()
        .any(|n| matches!(n, GraphNode::Running { .. }))
}

pub fn normalize_programs(list: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for p in list {
        let b = exe_basename(p);
        if b.is_empty() {
            continue;
        }
        let key = b.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(b);
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphDecision {
    Set(u8),
    Restore,
    Miss,
}

pub fn eval_graph(graph: &SwitchGraph, foreground: &str, running: &[String]) -> GraphDecision {
    let fg = exe_stem(foreground);
    let run: HashSet<String> = running.iter().map(|s| exe_stem(s)).collect();
    let by_id: HashMap<&str, &GraphNode> = graph.nodes.iter().map(|n| (n.id(), n)).collect();
    let mut ins: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &graph.edges {
        if by_id.contains_key(e.from.as_str()) && by_id.contains_key(e.to.as_str()) {
            ins.entry(e.to.as_str()).or_default().push(e.from.as_str());
        }
    }
    let mut actions: Vec<&GraphNode> = graph
        .nodes
        .iter()
        .filter(|n| matches!(n, GraphNode::SetProfile { .. } | GraphNode::Restore { .. }))
        .collect();
    actions.sort_by_key(|n| (n.priority().unwrap_or(0), n.id().to_string()));

    for node in actions {
        let mut visiting = HashSet::new();
        if eval_node(node.id(), &by_id, &ins, &fg, &run, &mut visiting) {
            return match node {
                GraphNode::SetProfile { profile, .. } => GraphDecision::Set(*profile),
                GraphNode::Restore { .. } => GraphDecision::Restore,
                _ => GraphDecision::Miss,
            };
        }
    }
    GraphDecision::Miss
}

fn eval_node(
    id: &str,
    by_id: &HashMap<&str, &GraphNode>,
    ins: &HashMap<&str, Vec<&str>>,
    fg: &str,
    run: &HashSet<String>,
    visiting: &mut HashSet<String>,
) -> bool {
    if !visiting.insert(id.to_string()) {
        return false;
    }
    let Some(node) = by_id.get(id) else {
        visiting.remove(id);
        return false;
    };
    let inputs = ins.get(id).map(Vec::as_slice).unwrap_or(&[]);
    let out = match node {
        GraphNode::Foreground { programs, .. } => {
            !fg.is_empty() && programs.iter().any(|p| exe_stem(p) == *fg)
        }
        GraphNode::Running { programs, .. } => programs.iter().any(|p| run.contains(&exe_stem(p))),
        GraphNode::And { .. } => {
            !inputs.is_empty()
                && inputs
                    .iter()
                    .all(|src| eval_node(src, by_id, ins, fg, run, visiting))
        }
        GraphNode::Or { .. } => inputs
            .iter()
            .any(|src| eval_node(src, by_id, ins, fg, run, visiting)),
        GraphNode::SetProfile { .. } | GraphNode::Restore { .. } => {
            if inputs.is_empty() {
                matches!(node, GraphNode::Restore { .. })
            } else {
                inputs
                    .iter()
                    .any(|src| eval_node(src, by_id, ins, fg, run, visiting))
            }
        }
    };
    visiting.remove(id);
    out
}

pub fn flatten_graph(graph: &SwitchGraph) -> Vec<(String, u8)> {
    let by_id: HashMap<&str, &GraphNode> = graph.nodes.iter().map(|n| (n.id(), n)).collect();
    let mut ins: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &graph.edges {
        ins.entry(e.to.as_str()).or_default().push(e.from.as_str());
    }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut actions: Vec<&GraphNode> = graph
        .nodes
        .iter()
        .filter(|n| matches!(n, GraphNode::SetProfile { .. }))
        .collect();
    actions.sort_by_key(|n| (n.priority().unwrap_or(0), n.id().to_string()));
    for node in actions {
        let GraphNode::SetProfile { profile, .. } = node else {
            continue;
        };
        let mut acc = Vec::new();
        collect_programs(node.id(), &by_id, &ins, &mut acc, &mut HashSet::new());
        for exe in acc {
            let key = (exe.to_ascii_lowercase(), *profile);
            if seen.insert(key) {
                out.push((exe, *profile));
            }
        }
    }
    out
}

fn collect_programs(
    id: &str,
    by_id: &HashMap<&str, &GraphNode>,
    ins: &HashMap<&str, Vec<&str>>,
    acc: &mut Vec<String>,
    visiting: &mut HashSet<String>,
) {
    if !visiting.insert(id.to_string()) {
        return;
    }
    let Some(node) = by_id.get(id) else {
        return;
    };
    match node {
        GraphNode::Foreground { programs, .. } | GraphNode::Running { programs, .. } => {
            for p in programs {
                let b = exe_basename(p);
                if !b.is_empty() {
                    acc.push(b);
                }
            }
        }
        _ => {
            if let Some(srcs) = ins.get(id) {
                for src in srcs {
                    collect_programs(src, by_id, ins, acc, visiting);
                }
            }
        }
    }
}

pub fn graph_from_rules(rules: &[(String, u8)]) -> SwitchGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for (i, (exe, profile)) in rules.iter().enumerate() {
        let exe = exe_basename(exe);
        if exe.is_empty() {
            continue;
        }
        let y = 40.0 + i as f64 * 170.0;
        let fid = format!("fg{i}");
        let pid = format!("sp{i}");
        nodes.push(GraphNode::Foreground {
            id: fid.clone(),
            x: 48.0,
            y,
            programs: vec![exe],
        });
        nodes.push(GraphNode::SetProfile {
            id: pid.clone(),
            x: 340.0,
            y,
            profile: *profile,
            priority: i.min(255) as u8,
            light_mode: None,
            bright: None,
            dim: None,
            leds: None,
        });
        edges.push(GraphEdge {
            id: format!("e{i}"),
            from: fid,
            to: pid,
        });
    }
    let y = 40.0 + rules.len() as f64 * 170.0;
    nodes.push(GraphNode::Restore {
        id: "else".into(),
        x: 340.0,
        y,
        priority: 9,
    });
    SwitchGraph { nodes, edges }
}

pub fn default_graph() -> SwitchGraph {
    SwitchGraph {
        nodes: vec![GraphNode::Restore {
            id: "else".into(),
            x: 360.0,
            y: 200.0,
            priority: 9,
        }],
        edges: Vec::new(),
    }
}

fn next_id(graph: &SwitchGraph, prefix: &str) -> String {
    let mut n = graph.nodes.len() + graph.edges.len() + 1;
    loop {
        let id = format!("{prefix}{n}");
        if graph.nodes.iter().all(|node| node.id() != id)
            && graph.edges.iter().all(|e| e.id != id)
        {
            return id;
        }
        n += 1;
    }
}

pub fn add_program(graph: &mut SwitchGraph, profile: u8, path: &str) {
    let exe = exe_basename(path);
    if exe.is_empty() {
        return;
    }
    strip_program(graph, &exe);
    let target = graph.nodes.iter().find_map(|n| match n {
        GraphNode::SetProfile {
            id, profile: p, y, ..
        } if *p == profile => Some((id.clone(), *y)),
        _ => None,
    });
    if let Some((pid, y)) = target {
        let from = graph
            .edges
            .iter()
            .find(|e| e.to == pid)
            .map(|e| e.from.clone());
        if let Some(from) = from {
            if let Some(GraphNode::Foreground { programs, .. }) =
                graph.nodes.iter_mut().find(|n| n.id() == from)
            {
                programs.push(exe);
                *programs = normalize_programs(programs);
                return;
            }
        }
        let fid = next_id(graph, "fg");
        let eid = next_id(graph, "e");
        graph.nodes.push(GraphNode::Foreground {
            id: fid.clone(),
            x: 48.0,
            y,
            programs: vec![exe],
        });
        graph.edges.push(GraphEdge {
            id: eid,
            from: fid,
            to: pid,
        });
        return;
    }
    let i = graph
        .nodes
        .iter()
        .filter(|n| matches!(n, GraphNode::SetProfile { .. }))
        .count();
    let y = 40.0 + i as f64 * 170.0;
    let fid = next_id(graph, "fg");
    let pid = next_id(graph, "sp");
    let eid = next_id(graph, "e");
    graph.nodes.push(GraphNode::Foreground {
        id: fid.clone(),
        x: 48.0,
        y,
        programs: vec![exe],
    });
    graph.nodes.push(GraphNode::SetProfile {
        id: pid.clone(),
        x: 340.0,
        y,
        profile,
        priority: i.min(255) as u8,
        light_mode: None,
        bright: None,
        dim: None,
        leds: None,
    });
    graph.edges.push(GraphEdge {
        id: eid,
        from: fid,
        to: pid,
    });
}

pub fn strip_program(graph: &mut SwitchGraph, exe: &str) {
    let needle = exe_stem(exe);
    for node in &mut graph.nodes {
        if let GraphNode::Foreground { programs, .. } | GraphNode::Running { programs, .. } = node {
            programs.retain(|p| exe_stem(p) != needle);
        }
    }
}

pub fn prune_empty(graph: &mut SwitchGraph) {
    let drop: HashSet<String> = graph
        .nodes
        .iter()
        .filter_map(|n| match n {
            GraphNode::Foreground { id, programs, .. }
            | GraphNode::Running { id, programs, .. }
                if programs.is_empty() =>
            {
                Some(id.clone())
            }
            _ => None,
        })
        .collect();
    if drop.is_empty() {
        return;
    }
    graph.nodes.retain(|n| !drop.contains(n.id()));
    graph
        .edges
        .retain(|e| !drop.contains(&e.from) && !drop.contains(&e.to));
}

pub fn remove_program(graph: &mut SwitchGraph, exe: &str) {
    strip_program(graph, exe);
    prune_empty(graph);
}

pub fn shift_after_delete(graph: &mut SwitchGraph, idx: u8) {
    let drop: HashSet<String> = graph
        .nodes
        .iter()
        .filter_map(|n| match n {
            GraphNode::SetProfile { id, profile, .. } if *profile == idx => Some(id.clone()),
            _ => None,
        })
        .collect();
    for node in &mut graph.nodes {
        if let GraphNode::SetProfile { profile, .. } = node {
            if *profile > idx {
                *profile -= 1;
            }
        }
    }
    graph.nodes.retain(|n| !drop.contains(n.id()));
    graph
        .edges
        .retain(|e| !drop.contains(&e.from) && !drop.contains(&e.to));
    prune_empty(graph);
}

pub fn sanitize(graph: &mut SwitchGraph) {
    for node in &mut graph.nodes {
        match node {
            GraphNode::Foreground { programs, .. } | GraphNode::Running { programs, .. } => {
                *programs = normalize_programs(programs);
            }
            GraphNode::SetProfile { leds, .. } => {
                if let Some(list) = leds {
                    list.truncate(9);
                    for v in list.iter_mut() {
                        if *v > 4 {
                            *v = 0;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let ids: HashSet<String> = graph.nodes.iter().map(|n| n.id().to_string()).collect();
    graph
        .edges
        .retain(|e| e.from != e.to && ids.contains(&e.from) && ids.contains(&e.to));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fg(id: &str, programs: &[&str]) -> GraphNode {
        GraphNode::Foreground {
            id: id.into(),
            x: 0.0,
            y: 0.0,
            programs: programs.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    fn run_n(id: &str, programs: &[&str]) -> GraphNode {
        GraphNode::Running {
            id: id.into(),
            x: 0.0,
            y: 0.0,
            programs: programs.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    fn and(id: &str) -> GraphNode {
        GraphNode::And {
            id: id.into(),
            x: 0.0,
            y: 0.0,
        }
    }

    fn set_p(id: &str, profile: u8, priority: u8) -> GraphNode {
        GraphNode::SetProfile {
            id: id.into(),
            x: 0.0,
            y: 0.0,
            profile,
            priority,
            light_mode: None,
            bright: None,
            dim: None,
            leds: None,
        }
    }

    fn edge(id: &str, from: &str, to: &str) -> GraphEdge {
        GraphEdge {
            id: id.into(),
            from: from.into(),
            to: to.into(),
        }
    }

    #[test]
    fn first_priority_wins() {
        let g = SwitchGraph {
            nodes: vec![
                fg("a", &["chrome.exe"]),
                fg("b", &["chrome.exe"]),
                set_p("p1", 1, 0),
                set_p("p2", 2, 1),
            ],
            edges: vec![edge("e1", "a", "p1"), edge("e2", "b", "p2")],
        };
        assert_eq!(
            eval_graph(&g, "chrome.exe", &[]),
            GraphDecision::Set(1)
        );
    }

    #[test]
    fn or_within_foreground_list() {
        let g = SwitchGraph {
            nodes: vec![fg("a", &["SLDWORKS.exe", "Inventor.exe"]), set_p("p", 2, 0)],
            edges: vec![edge("e", "a", "p")],
        };
        assert_eq!(eval_graph(&g, "inventor.exe", &[]), GraphDecision::Set(2));
        assert_eq!(eval_graph(&g, "notepad.exe", &[]), GraphDecision::Miss);
    }

    #[test]
    fn and_foreground_and_running() {
        let g = SwitchGraph {
            nodes: vec![
                fg("f", &["chrome.exe"]),
                run_n("r", &["Discord.exe"]),
                and("and1"),
                set_p("p", 1, 0),
            ],
            edges: vec![
                edge("e1", "f", "and1"),
                edge("e2", "r", "and1"),
                edge("e3", "and1", "p"),
            ],
        };
        assert_eq!(
            eval_graph(&g, "chrome.exe", &["Discord.exe".into()]),
            GraphDecision::Set(1)
        );
        assert_eq!(
            eval_graph(&g, "chrome.exe", &["notepad.exe".into()]),
            GraphDecision::Miss
        );
    }

    #[test]
    fn uses_running_only_when_graph_has_running_node() {
        let g = graph_from_rules(&[("chrome.exe".into(), 1)]);
        assert!(!uses_running(&g));
        let g = SwitchGraph {
            nodes: vec![run_n("r", &["Discord.exe"]), set_p("p", 0, 0)],
            edges: vec![edge("e", "r", "p")],
        };
        assert!(uses_running(&g));
    }

    #[test]
    fn restore_with_no_input_is_else() {
        let g = SwitchGraph {
            nodes: vec![
                fg("a", &["cad.exe"]),
                set_p("p", 1, 0),
                GraphNode::Restore {
                    id: "else".into(),
                    x: 0.0,
                    y: 0.0,
                    priority: 9,
                },
            ],
            edges: vec![edge("e", "a", "p")],
        };
        assert_eq!(eval_graph(&g, "cad.exe", &[]), GraphDecision::Set(1));
        assert_eq!(eval_graph(&g, "other.exe", &[]), GraphDecision::Restore);
    }

    #[test]
    fn migrate_roundtrip_matches_old_rules() {
        let g = graph_from_rules(&[("SLDWORKS.exe".into(), 2), ("chrome.exe".into(), 1)]);
        assert_eq!(
            eval_graph(&g, r"C:\SW\SLDWORKS.EXE", &[]),
            GraphDecision::Set(2)
        );
        assert_eq!(eval_graph(&g, "chrome.exe", &[]), GraphDecision::Set(1));
        assert_eq!(eval_graph(&g, "x.exe", &[]), GraphDecision::Restore);
    }
}
