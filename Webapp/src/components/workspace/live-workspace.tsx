"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { WorkspaceShell } from "./workspace-shell";

export function LiveWorkspace() {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const seededRef = useRef(false);

  const dashboard = useQuery(api.workspace.getDashboard, {
    selectedMeetingId: selectedMeetingId as Id<"meetings"> | null,
  });

  const seedDemoWorkspace = useMutation(api.workspace.seedDemoWorkspace);
  const createFolder = useMutation(api.workspace.createFolder);
  const createMeetingFromDeviceSync = useMutation(api.workspace.createMeetingFromDeviceSync);
  const sendMessage = useMutation(api.workspace.sendMessage);

  useEffect(() => {
    if (!dashboard || seededRef.current || dashboard.folders.length > 0) {
      return;
    }

    seededRef.current = true;
    void seedDemoWorkspace({}).then((result) => {
      if (result?.firstMeetingId) {
        setSelectedMeetingId(result.firstMeetingId);
      }
    });
  }, [dashboard, seedDemoWorkspace]);

  const fallbackFolderId = useMemo(
    () => dashboard?.activeMeeting?.folderId ?? dashboard?.folders[0]?.id ?? null,
    [dashboard?.activeMeeting?.folderId, dashboard?.folders],
  );

  if (!dashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="glass-panel metal-border w-full max-w-xl rounded-[2rem] p-10 text-center">
          <p className="font-display text-sm uppercase tracking-[0.4em] text-sp-muted">Connecting</p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-foreground">
            Syncing SmartPuck workspace
          </h1>
          <p className="mt-4 text-sm leading-7 text-sp-muted">
            Waiting for Convex to return the initial dashboard payload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceShell
      dashboard={dashboard}
      mode="live"
      isMutating={isPending}
      fallbackFolderId={fallbackFolderId}
      onCreateFolder={(name) => {
        startTransition(() => {
          void createFolder({ name });
        });
      }}
      onConnectDevice={async (folderId, transport) => {
        const meetingId = await createMeetingFromDeviceSync({
          folderId: folderId as Id<"folders">,
          transport,
        });
        setSelectedMeetingId(meetingId);
        return meetingId;
      }}
      onSelectMeeting={(meetingId) => {
        setSelectedMeetingId(meetingId);
      }}
      onSendMessage={(meetingId, body) => {
        startTransition(() => {
          void sendMessage({
            meetingId: meetingId as Id<"meetings">,
            body,
          });
        });
      }}
    />
  );
}
