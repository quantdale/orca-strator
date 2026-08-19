# Design: Private Phone Access and Notifications

## 1. Summary

Change 007 implements mobile responsive UI, Tailscale Serve system guidance, and notification routing.

Key components:
1. **Responsive Mobile UI (`apps/ui`)**:
   - Touch-friendly control buttons (Start, Pause, Resume, Stop, Recover).
   - Mobile-optimized repository summary cards with live status badges.
   - Drawer/collapsible log and timeline views.
2. **Notification Manager (`apps/ui/src/notifications.ts`)**:
   - Browser Web Notifications API integration with quiet mode for regular iterations.
   - Dispatches browser notifications for `GOAL_COMPLETE`, `NEEDS_HUMAN`, `BLOCKED`, `SOL_STALLED`, `EXECUTOR_UNAVAILABLE`, `RECOVERY_REQUIRED`.
3. **Tailscale Guidance Endpoint (`apps/controller/src/http/routes/system.ts`)**:
   - `GET /api/system/tailscale` returns server port, loopback address, and instructions for `tailscale serve --bg https / http://127.0.0.1:<port>`.
