import { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { ServerOptions } from "socket.io";

/**
 * Reads CORS_ORIGIN from ConfigService at `app.listen()` time rather than at
 * module-decoration time, since dotenv-loaded env vars aren't reliably
 * populated yet when `@WebSocketGateway()` decorators are evaluated during
 * module import.
 */
export class ConfigurableSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigin, credentials: true },
    });
  }
}
