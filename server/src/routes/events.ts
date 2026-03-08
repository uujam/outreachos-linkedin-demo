/**
 * B-006b — Server-Sent Events (SSE) endpoint for real-time timeline updates (F-012).
 * GET /api/events — opens a persistent SSE connection scoped to the authenticated client.
 * New messages arriving via webhooks are broadcast to all open connections for that client.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';

const router = Router();

// In-process client registry: clientId → set of SSE response objects
const clients = new Map<string, Set<Response>>();

/**
 * Broadcast an event to all open SSE connections for a given clientId.
 * Called from webhook handlers (heyreach, instantly, vapi) after creating a Message.
 */
export function broadcastToClient(clientId: string, event: string, data: unknown): void {
  const connections = clients.get(clientId);
  if (!connections || connections.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of connections) {
    try {
      res.write(payload);
    } catch {
      // Connection already closed — will be cleaned up on 'close'
    }
  }
}

// ─── GET /api/events ──────────────────────────────────────────────────────────

router.get('/events', requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send an initial ping so the client knows the connection is live
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

  // Register this connection
  if (!clients.has(clientId)) {
    clients.set(clientId, new Set());
  }
  clients.get(clientId)!.add(res);

  // Keep-alive heartbeat every 30s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    const connections = clients.get(clientId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        clients.delete(clientId);
      }
    }
  });
});

export default router;
