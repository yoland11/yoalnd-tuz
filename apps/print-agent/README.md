# AJN Print Agent (Windows)

The agent is a separate Electron tray application. It contains no database URL,
Supabase service key, admin password, or ERP session. It stores only its limited
agent credential encrypted with Windows DPAPI through Electron `safeStorage`.

## Install and register

1. In AJN ERP open **النظام → طابور الطباعة**, create a Windows device, and copy
   the one-time registration token immediately.
2. Build/install the Windows package with `pnpm --dir apps/print-agent run dist:win`.
3. Start **AJN Print Agent**, enter the AJN HTTPS URL, Agent ID, and registration
   token. The agent discovers installed Windows printers in its next heartbeat.
4. Back in AJN, select a discovered printer, set 80mm or 58mm, and mark it the
   default. Mobile users can now use **طباعة مباشرة** on a sales invoice.

The agent heartbeats every 30 seconds and polls only its own queue every 4
seconds. Jobs are claimed atomically by the server. A machine that is offline
does not lose jobs; they remain queued until it reconnects.

## Windows-driver receipt check

After building, an administrator can validate the canonical 80mm renderer with
an installed printer without registering an Agent or changing the server queue:

```powershell
& ".\release\win-unpacked\AJN Print Agent.exe" --test-printer="XP-80C"
```

This prints one clearly labelled `AJN PRINT TEST` receipt through the selected
Windows driver. It does not contact AJN ERP or create a print job.
