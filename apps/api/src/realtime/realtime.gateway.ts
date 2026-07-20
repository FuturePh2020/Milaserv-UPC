import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import type { AccessTokenPayload } from "../auth/strategies/jwt.strategy";

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const [key, ...rest] = pair.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    }),
  );
}

/**
 * Pushes "refresh" events to clients subscribed to a channel (e.g. "orders",
 * "retention", or an entity-scoped "timeline:Order:<id>" room), so operational
 * pages and TimelineFeed can update immediately instead of waiting for their
 * next poll tick. Auth reuses the same access_token cookie as the REST API;
 * unauthenticated sockets are disconnected on connect.
 */
@WebSocketGateway({ path: "/api/socket.io" })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const cookies = parseCookies(client.handshake.headers.cookie);
      const token = cookies["access_token"];
      if (!token) throw new Error("missing access_token cookie");
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch (err) {
      this.logger.debug(`Rejecting unauthenticated socket: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage("subscribe")
  handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() channels: string[]) {
    for (const channel of channels ?? []) client.join(channel);
  }

  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() channels: string[]) {
    for (const channel of channels ?? []) client.leave(channel);
  }

  /** Broadcasts a refresh notification to every socket subscribed to `channel`. */
  emitRefresh(channel: string, metadata?: Record<string, unknown>) {
    this.server?.to(channel).emit("refresh", { channel, at: new Date().toISOString(), ...metadata });
  }
}
