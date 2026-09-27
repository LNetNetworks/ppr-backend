import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ExternalApiClient } from "../../integrations/external-api.client";

interface BridgeTransferInput {
  to: string;
  amount: number | string;
}

interface BridgeWithdrawInput extends BridgeTransferInput {
  projectPrivateKey: string;
}

/**
 * Simple wrapper around the Bridge API.
 * Provides only the two operations that are currently required: deposit and retiro.
 */
@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly cfg: ConfigService,
    private readonly http: ExternalApiClient,
  ) {
    const configuredUrl = (this.cfg.get<string>("bridge.url") ?? "").trim();
    this.baseUrl = configuredUrl.replace(/\/+$/, "");
    this.apiKey = this.cfg.get<string>("bridge.apiKey") ?? "";
    // Debe mantenerse por debajo del bloqueo de las tareas de cola
    // (lockSeconds en queue.runner). Si lo superara, una tarea viva podría
    // darse por abandonada mientras su transferencia sigue en vuelo.
    this.timeoutMs = this.cfg.getOrThrow<number>("bridge.timeoutMs");

    if (!this.baseUrl) {
      throw new BadRequestException("BRIDGE_API_URL not configured");
    }
    if (!this.apiKey) {
      throw new BadRequestException("BRIDGE_API_KEY not configured");
    }
  }

  async deposit(input: BridgeTransferInput) {
    return this.postRequest("/deposit", input);
  }

  async retiro(input: BridgeTransferInput) {
    return this.postRequest("/retiro", input);
  }

  async withdraw(input: BridgeWithdrawInput) {
    return this.postRequest("/withdraw", input);
  }

  private async postRequest(
    endpoint: string,
    input: BridgeTransferInput & { projectPrivateKey?: string },
  ) {
    const payload = this.validateInput(input);
    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;
    const url = `${this.baseUrl}${normalizedEndpoint}`;
    if (normalizedEndpoint === "/withdraw" && !input.projectPrivateKey) {
      throw new BadRequestException(
        "Bridge withdraw requires projectPrivateKey",
      );
    }
    const finalPayload =
      normalizedEndpoint === "/withdraw" && input.projectPrivateKey
        ? { ...payload, projectPrivateKey: input.projectPrivateKey }
        : payload;
    try {
      return await this.http.post(url, finalPayload, {
        headers: {
          Authorization: `ApiKey ${this.apiKey}`,
        },
        timeout: this.timeoutMs,
      });
    } catch (err: any) {
      this.logger.error(
        `Bridge API error on ${endpoint}: ${err?.message ?? err}`,
      );
      throw new InternalServerErrorException(
        `Error calling Bridge API (${endpoint})`,
      );
    }
  }

  private validateInput(input: BridgeTransferInput) {
    if (!input?.to || typeof input.to !== "string" || !input.to.trim()) {
      throw new BadRequestException("Bridge target ('to') is required");
    }

    const amount = Number(input.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      throw new BadRequestException("Bridge amount must be a positive number");
    }

    return {
      to: input.to.trim(),
      amount,
    };
  }
}
