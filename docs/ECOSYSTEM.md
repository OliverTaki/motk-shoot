# Video assist, shortcuts, and Observer

Phase 7 adds three optional surfaces around the core shooting workflow. None of
them changes captures, edit lists, RAW originals, or production backups.

## Clean second display

Press **MONITOR** in the top bar. The browser opens `monitor.html` as a clean
black video-assist window showing the main viewport without application chrome.
Move it to the second display and click the picture to enter or leave fullscreen.
The window reads the already-composited same-origin viewport directly, so it
follows live view, review, playback, guides, onion skin, and monitor effects
without creating another camera connection.

If the browser blocks it, allow pop-ups for the MOTK Shoot origin and press the
button again. Closing the shooting window leaves the monitor in a safe waiting
state.

## Remappable controls and WebHID

Open **? → Configure shortcuts / keypad**. Select a keyboard assignment and
press its replacement key. Conflicting assignments are rejected rather than
silently disabling another control. **Restore defaults** removes all custom
mappings. Mappings are local to that browser profile.

For a macro pad or custom controller exposed through WebHID:

1. Press **Connect WebHID keypad…** and choose the device in the browser prompt.
2. Press **Learn HID** beside an action.
3. Press the desired hardware control once.

MOTK Shoot stores the device/report signature and dispatches the same action as
the keyboard mapping. It only receives input reports; it never sends output
reports, configuration, lighting, or motion-control commands to the device.
Availability and permission depend on the browser and device.

## Read-only LAN Observer

On the shooting computer, start the combined agent explicitly on the LAN:

```sh
node bridge/production-agent.mjs --backend auto --host 0.0.0.0 --serve-app
```

Keep the shooting app connected to `ws://127.0.0.1:8793`. On a phone, tablet,
or another computer on the same trusted network, open:

```text
http://<shooting-computer-ip>:8793/?observer=1
```

The Observer page starts no camera, database, project editor, shortcuts, or
production controls. It subscribes to a capped 5 fps JPEG preview and minimal
project/edit/frame state. The agent permits LAN clients to subscribe but rejects
their tether, folder, camera-setting, capture, and publish messages. Only a
loopback connection on the shooting computer can control or publish.

Browser WebSocket origins are checked before connection. Localhost and the
agent's own Observer origin are allowed; unrelated sites receive HTTP 403. If
the shooting app is hosted on a separate trusted origin, pass that exact origin
with `--allow-origin https://shoot.example.org`.

`--serve-app` exposes only the app's required root files plus `js/` and `css/`;
workspace documents, test folders, temporary folders, production media, and
backups are not served. Use this feature only on a trusted private network and
stop the agent when observation is finished. A host firewall may require an
explicit private-network inbound rule for the selected port.
