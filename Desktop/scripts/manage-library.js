const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const MEETINGS_DIR = "Meetings";
const WORKSPACES_DIR = "Workspaces";

function getLibraryRoot() {
  return process.env.SMARTPUCK_HOME || path.join(os.homedir(), "Documents", "SmartPuck");
}

function slug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function loadLibrary(root) {
  const meetingsDir = path.join(root, MEETINGS_DIR);
  const workspacesDir = path.join(root, WORKSPACES_DIR);

  const meetings = [];
  if (fs.existsSync(meetingsDir)) {
    const entries = fs.readdirSync(meetingsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const meetingJsonPath = path.join(meetingsDir, entry.name, "meeting.json");
        if (fs.existsSync(meetingJsonPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(meetingJsonPath, "utf8"));
            meetings.push({
              path: path.join(meetingsDir, entry.name),
              metadata,
            });
          } catch (e) {
            console.error(`Error reading meeting ${entry.name}:`, e);
          }
        }
      }
    }
  }

  const workplaces = [];
  if (fs.existsSync(workspacesDir)) {
    const entries = fs.readdirSync(workspacesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const manifestPath = path.join(workspacesDir, entry.name, ".smartpuck-workspace.json");
        if (fs.existsSync(manifestPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            workplaces.push({
              path: path.join(workspacesDir, entry.name),
              metadata,
              meetings: [],
            });
          } catch (e) {
            console.error(`Error reading workspace ${entry.name}:`, e);
          }
        }
      }
    }
  }

  for (const workplace of workplaces) {
    workplace.meetings = meetings.filter((meeting) =>
      (meeting.metadata.workspaceIds || []).includes(workplace.metadata.id)
    );
  }

  const linkedIds = new Set(workplaces.map((w) => w.metadata.id));
  const inbox = meetings.filter(
    (meeting) => !(meeting.metadata.workspaceIds || []).some((id) => linkedIds.has(id))
  );

  return { meetings, workplaces, inbox };
}

function rebuildIndexes(root, library) {
  const { workplaces, meetings } = library;

  for (const workplace of workplaces) {
    const meetingsPath = path.join(workplace.path, "meetings.md");
    let customNotes = "";

    if (fs.existsSync(meetingsPath)) {
      const currentContent = fs.readFileSync(meetingsPath, "utf8");
      const dividerIndex = currentContent.indexOf("## Linked Meetings");
      if (dividerIndex !== -1) {
        let rawNotes = currentContent.substring(0, dividerIndex).trim();
        while (rawNotes.endsWith("---")) {
          rawNotes = rawNotes.substring(0, rawNotes.length - 3).trim();
        }
        customNotes = rawNotes + "\n\n";
      } else {
        customNotes = currentContent.trim() + "\n\n";
      }
    } else {
      customNotes = `# ${workplace.metadata.name}\n\n## Memory & Notes\nUse this section to store workspace-specific jargon, names, and memory. AI agents will read this to get context.\n\n`;
    }

    const indexLines = [
      "## Linked Meetings",
      "This section is automatically updated by SmartPuck. Do not edit manually.",
      "",
    ];

    if (workplace.meetings.length === 0) {
      indexLines.push("_No meetings linked yet._", "");
    } else {
      for (const meeting of workplace.meetings) {
        const transcript = path.relative(workplace.path, path.join(meeting.path, "transcript.md")).replaceAll("\\", "/");
        const metadata = path.relative(workplace.path, path.join(meeting.path, "meeting.json")).replaceAll("\\", "/");
        indexLines.push(`- [${meeting.metadata.title}](${transcript}) — [metadata](${metadata})`);
      }
      indexLines.push("");
    }

    const oldReadme = path.join(workplace.path, "README.md");
    if (fs.existsSync(oldReadme)) {
      try { fs.unlinkSync(oldReadme); } catch {}
    }

    const finalContent = customNotes.trim() + "\n\n---\n\n" + indexLines.join("\n") + "\n";
    fs.writeFileSync(meetingsPath, finalContent, "utf8");
  }

  const unique = [...new Map(meetings.map((meeting) => [meeting.metadata.id, meeting])).values()];
  const pending = unique.filter((meeting) => meeting.metadata.curationStatus === "pending");
  const lines = [
    "# Inbox",
    "",
    `Pending: ${pending.length}`,
    "",
  ];
  if (pending.length === 0) {
    lines.push("_Nothing is waiting for curation._", "");
  } else {
    for (const meeting of pending) {
      const metadataPath = path.relative(root, path.join(meeting.path, "meeting.json")).replaceAll("\\", "/");
      lines.push(
        `- [${meeting.metadata.title}](${metadataPath}) — ${meeting.metadata.status}; captured ${meeting.metadata.capturedAt}`
      );
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(root, "NEW.md"), `${lines.join("\n")}\n`, "utf8");
}

function createWorkspace(root, name) {
  const clean = name.trim();
  if (!clean) throw new Error("Workspace name is required.");
  const now = new Date().toISOString();
  
  const workspacesDir = path.join(root, WORKSPACES_DIR);
  const targetDir = path.join(workspacesDir, slug(clean));
  if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, ".smartpuck-workspace.json"))) {
    throw new Error("A workspace with that name already exists.");
  }
  
  fs.mkdirSync(targetDir, { recursive: true });
  
  const library = loadLibrary(root);
  const nextSortOrder = library.workplaces.reduce(
    (max, w) => Math.max(max, w.metadata.sortOrder ?? -1),
    -1
  ) + 1;
  
  const metadata = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: clean,
    sortOrder: nextSortOrder,
    createdAt: now,
    updatedAt: now,
  };
  
  fs.writeFileSync(
    path.join(targetDir, ".smartpuck-workspace.json"),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );
  console.log(`Workspace "${clean}" created successfully.`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function linkMeeting(root, meetingQuery, workspaceQuery) {
  const library = loadLibrary(root);
  
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(`Meeting not found for query: ${meetingQuery}`);
  }
  
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(`Workspace not found for query: ${workspaceQuery}`);
  }
  
  const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
  if (!currentWorkspaceIds.includes(workspace.metadata.id)) {
    meeting.metadata.workspaceIds = [...currentWorkspaceIds, workspace.metadata.id];
    meeting.metadata.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(
      path.join(meeting.path, "meeting.json"),
      JSON.stringify(meeting.metadata, null, 2),
      "utf8"
    );
    console.log(`Linked meeting "${meeting.metadata.title}" to workspace "${workspace.metadata.name}"`);
  } else {
    console.log(`Meeting "${meeting.metadata.title}" is already linked to workspace "${workspace.metadata.name}"`);
  }
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function unlinkMeeting(root, meetingQuery, workspaceQuery) {
  const library = loadLibrary(root);
  
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(`Meeting not found for query: ${meetingQuery}`);
  }
  
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(`Workspace not found for query: ${workspaceQuery}`);
  }
  
  const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
  if (currentWorkspaceIds.includes(workspace.metadata.id)) {
    meeting.metadata.workspaceIds = currentWorkspaceIds.filter((id) => id !== workspace.metadata.id);
    meeting.metadata.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(
      path.join(meeting.path, "meeting.json"),
      JSON.stringify(meeting.metadata, null, 2),
      "utf8"
    );
    console.log(`Unlinked meeting "${meeting.metadata.title}" from workspace "${workspace.metadata.name}"`);
  } else {
    console.log(`Meeting "${meeting.metadata.title}" is not linked to workspace "${workspace.metadata.name}"`);
  }
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function curateMeeting(root, meetingQuery, title, summary, workspacesStr) {
  const library = loadLibrary(root);
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(`Meeting not found for query: ${meetingQuery}`);
  }
  
  if (title) meeting.metadata.title = title;
  if (summary) meeting.metadata.summary = summary;
  
  if (workspacesStr) {
    const wNames = workspacesStr.split(",").map((s) => s.trim()).filter(Boolean);
    const resolvedIds = [];
    for (const name of wNames) {
      const workspace = library.workplaces.find(
        (w) =>
          w.metadata.id === name ||
          w.metadata.name.toLowerCase() === name.toLowerCase() ||
          path.basename(w.path) === slug(name)
      );
      if (!workspace) {
        throw new Error(`Workspace not found: ${name}`);
      }
      resolvedIds.push(workspace.metadata.id);
    }
    meeting.metadata.workspaceIds = resolvedIds;
  }
  
  meeting.metadata.curationStatus = "curated";
  meeting.metadata.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(
    path.join(meeting.path, "meeting.json"),
    JSON.stringify(meeting.metadata, null, 2),
    "utf8"
  );
  console.log(`Curated meeting "${meeting.metadata.title}" successfully.`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function deleteWorkspace(root, workspaceQuery) {
  const library = loadLibrary(root);
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(`Workspace not found for query: ${workspaceQuery}`);
  }
  
  // Unlink all meetings from this workspace
  for (const meeting of library.meetings) {
    const currentWorkspaceIds = meeting.metadata.workspaceIds || [];
    if (currentWorkspaceIds.includes(workspace.metadata.id)) {
      meeting.metadata.workspaceIds = currentWorkspaceIds.filter((id) => id !== workspace.metadata.id);
      meeting.metadata.updatedAt = new Date().toISOString();
      fs.writeFileSync(
        path.join(meeting.path, "meeting.json"),
        JSON.stringify(meeting.metadata, null, 2),
        "utf8"
      );
    }
  }
  
  // Safely delete workspace directory
  if (fs.existsSync(workspace.path)) {
    fs.rmSync(workspace.path, { recursive: true, force: true });
  }
  console.log(`Deleted workspace "${workspace.metadata.name}" successfully.`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function renameWorkspace(root, workspaceQuery, newName) {
  const library = loadLibrary(root);
  const workspace = library.workplaces.find(
    (w) =>
      w.metadata.id === workspaceQuery ||
      w.metadata.name.toLowerCase() === workspaceQuery.toLowerCase() ||
      path.basename(w.path) === slug(workspaceQuery)
  );
  if (!workspace) {
    throw new Error(`Workspace not found for query: ${workspaceQuery}`);
  }
  
  const oldPath = workspace.path;
  const targetDir = path.join(path.dirname(oldPath), slug(newName));
  
  if (fs.existsSync(targetDir) && oldPath !== targetDir) {
    throw new Error("A workspace with that renamed folder already exists.");
  }
  
  workspace.metadata.name = newName;
  workspace.metadata.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(
    path.join(oldPath, ".smartpuck-workspace.json"),
    JSON.stringify(workspace.metadata, null, 2),
    "utf8"
  );
  
  if (oldPath !== targetDir) {
    fs.renameSync(oldPath, targetDir);
  }
  console.log(`Renamed workspace to "${newName}" successfully.`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function trashMeeting(root, meetingQuery) {
  const library = loadLibrary(root);
  const meeting = library.meetings.find(
    (m) =>
      m.metadata.id === meetingQuery ||
      m.metadata.id.startsWith(meetingQuery) ||
      path.basename(m.path).endsWith(meetingQuery)
  );
  if (!meeting) {
    throw new Error(`Meeting not found for query: ${meetingQuery}`);
  }
  
  const trashBase = path.join(root, "Trash");
  if (!fs.existsSync(trashBase)) {
    fs.mkdirSync(trashBase, { recursive: true });
  }
  
  const targetPath = path.join(trashBase, path.basename(meeting.path));
  fs.renameSync(meeting.path, targetPath);
  console.log(`Moved meeting "${meeting.metadata.title}" to Trash.`);
  
  const updatedLibrary = loadLibrary(root);
  rebuildIndexes(root, updatedLibrary);
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const root = getLibraryRoot();
  
  try {
    switch (command) {
      case "create-workspace":
        if (!args[1]) throw new Error("Missing workspace name argument.");
        createWorkspace(root, args[1]);
        break;
      case "link":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js link <meeting-id> <workspace-name-or-id>");
        linkMeeting(root, args[1], args[2]);
        break;
      case "unlink":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js unlink <meeting-id> <workspace-name-or-id>");
        unlinkMeeting(root, args[1], args[2]);
        break;
      case "curate":
        if (!args[1]) throw new Error("Usage: node manage-library.js curate <meeting-id> --title \"...\" --summary \"...\" [--workspaces \"...\"]");
        const meetingId = args[1];
        let titleVal = "";
        let summaryVal = "";
        let workspacesVal = "";
        for (let i = 2; i < args.length; i++) {
          if (args[i] === "--title") {
            if (!args[i+1]) throw new Error("Missing value for flag: --title. Usage: --title \"Your Title\"");
            titleVal = args[i+1];
            i++;
          } else if (args[i] === "--summary") {
            if (!args[i+1]) throw new Error("Missing value for flag: --summary. Usage: --summary \"Your summary text\"");
            summaryVal = args[i+1];
            i++;
          } else if (args[i] === "--workspaces") {
            if (!args[i+1]) throw new Error("Missing value for flag: --workspaces. Usage: --workspaces \"Workspace1, Workspace2\"");
            workspacesVal = args[i+1];
            i++;
          }
        }
        if (!titleVal) throw new Error("Missing required flag: --title. You must provide a curation title using: --title \"...\"");
        if (!summaryVal) throw new Error("Missing required flag: --summary. You must provide a curation summary using: --summary \"...\"");
        curateMeeting(root, meetingId, titleVal, summaryVal, workspacesVal);
        break;
      case "delete-workspace":
        if (!args[1]) throw new Error("Usage: node manage-library.js delete-workspace <workspace-name-or-id>");
        deleteWorkspace(root, args[1]);
        break;
      case "rename-workspace":
        if (!args[1] || !args[2]) throw new Error("Usage: node manage-library.js rename-workspace <old-name-or-id> <new-name>");
        renameWorkspace(root, args[1], args[2]);
        break;
      case "trash":
        if (!args[1]) throw new Error("Usage: node manage-library.js trash <meeting-id>");
        trashMeeting(root, args[1]);
        break;
      case "rebuild":
        const lib = loadLibrary(root);
        rebuildIndexes(root, lib);
        console.log("Library indexes successfully rebuilt.");
        break;
      default:
        console.log(`
SmartPuck Library CLI Manager

Usage:
  node manage-library.js create-workspace <workspace-name>
  node manage-library.js delete-workspace <workspace-name-or-id>
  node manage-library.js rename-workspace <old-name-or-id> <new-name>
  node manage-library.js link <meeting-id-or-suffix> <workspace-name-or-id>
  node manage-library.js unlink <meeting-id-or-suffix> <workspace-name-or-id>
  node manage-library.js curate <meeting-id-or-suffix> --title "..." --summary "..." [--workspaces "..."]
  node manage-library.js trash <meeting-id-or-suffix>
  node manage-library.js rebuild
`);
        break;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

