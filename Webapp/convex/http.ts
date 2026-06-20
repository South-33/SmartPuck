import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/device/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedToken = process.env.SMARTPUCK_DEVICE_TOKEN;
    if (!expectedToken) {
      return Response.json({ error: "Device token is not configured" }, { status: 500 });
    }

    const body = (await request.json()) as {
      token?: string;
      baseUrl?: string;
      localIp?: string;
      mac?: string;
      network?: string;
      mode?: string;
      firmwareVersion?: string;
      storage?: string;
      storageReady?: boolean;
      storageMode?: string;
      storageFreeBytes?: number;
      storageTotalBytes?: number;
      batteryPercent?: number | null;
      batteryCharging?: boolean | null;
      lastStatus?: string;
    };

    if (body.token !== expectedToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!body.baseUrl) {
      return Response.json({ error: "Missing baseUrl" }, { status: 400 });
    }

    await ctx.runMutation(internal.workspace.recordDeviceHeartbeat, {
      baseUrl: body.baseUrl,
      localIp: body.localIp,
      mac: body.mac,
      network: body.network,
      mode: body.mode,
      firmwareVersion: body.firmwareVersion,
      storage: body.storage,
      storageReady: body.storageReady,
      storageMode: body.storageMode,
      storageFreeBytes: body.storageFreeBytes,
      storageTotalBytes: body.storageTotalBytes,
      batteryPercent: body.batteryPercent ?? undefined,
      batteryCharging: body.batteryCharging ?? undefined,
      lastStatus: body.lastStatus ?? "SmartPuck online",
    });

    return Response.json({ ok: true });
  }),
});

export default http;
