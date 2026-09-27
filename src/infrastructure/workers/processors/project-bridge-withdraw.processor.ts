import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HDNodeWallet } from "ethers";
import { QueueTaskProcessor } from "./queue-task.processor";
import { ProjectRepository } from "../../../domain/projects/project.repository";
import { BridgeService } from "../../../infrastructure/integrations/bridge/bridge.service";
import { TokenBlockchainPort } from "../../../application/integrations/ports/token.blockchain.port";
import { ContributionRepository } from "../../../domain/contributions/contribution.repository";
import { PhaseProjectRepository } from "../../../domain/phases/phase-project.repository";
import { TransferStatus } from "../../../domain/shared/transfer-status.enum";

@Injectable()
export class ProjectBridgeWithdrawProcessor implements QueueTaskProcessor {
  type = "PROJECT_BRIDGE_WITHDRAW";

  constructor(
    private readonly repoProject: ProjectRepository,
    private readonly config: ConfigService,
    private readonly chain: TokenBlockchainPort,
    private readonly bridge: BridgeService,
    private readonly repoContribution: ContributionRepository,
    private readonly repoPhaseProject: PhaseProjectRepository,
  ) {}

  /**
   * Cierra como fallida la contribución de una tarea que quedó abandonada. El
   * monto no se acumula en la fase: esos fondos no se movieron, o su movimiento
   * quedó en duda.
   */
  async markFailed(payload: any): Promise<void> {
    await this.resolveContribution(
      payload?.contributionId,
      TransferStatus.FAILED,
    );
  }

  private async resolveContribution(
    contributionId: string | undefined,
    status: TransferStatus,
  ): Promise<void> {
    if (!contributionId) return;

    const contribution = await this.repoContribution.findById(contributionId);
    if (!contribution) return;

    contribution.status = status;
    await this.repoContribution.save(contribution);

    if (status !== TransferStatus.DONE) return;

    const phaseProject = await this.repoPhaseProject.findById(
      contribution.id_phase_project,
    );
    if (!phaseProject) return;

    phaseProject.contribution_received =
      (phaseProject.contribution_received ?? 0) + contribution.deposit_amount;
    await this.repoPhaseProject.save(phaseProject);
  }

  async process(task: { payload: any; jobId: string; id: string }) {
    const projectId = task?.payload?.projectId;
    const idPhase = task?.payload?.id_phase;
    const contributionId = task?.payload?.contributionId;
    const amount = Number(task?.payload?.amount);

    if (!projectId || !contributionId || !idPhase) {
      throw new BadRequestException("Invalid withdraw task payload");
    }

    if (Number.isNaN(amount) || amount <= 0) {
      throw new BadRequestException("Withdraw amount is invalid");
    }

    const project = await this.repoProject.findById(projectId);
    if (!project) {
      throw new NotFoundException(`Project with id "${projectId}" not found`);
    }

    const projectWallet = project.wallet_token?.trim();
    if (!projectWallet) {
      throw new BadRequestException(
        `Project wallet token is missing for project "${projectId}"`,
      );
    }

    const taskTo = task?.payload?.to?.trim();

    const seedSponsor = this.config.get<string>("blockchain.gsponsor_seed")!;
    const walletDerivationNamespace =
      this.config.get<number>("wallet.derivationNamespace") ?? 0;
    const projectPrivateKey = this.resolveProjectWallet({
      seedSponsor,
      walletIndexToken: project.wallet_index_token,
      walletToken: projectWallet,
      walletDerivationNamespace,
    }).privateKey;

    if (!project.wallet_provider) {
      throw new BadRequestException(
        `Project wallet provider is missing for project "${projectId}"`,
      );
    }

    const projectProviderWallet = project.wallet_provider.trim();
    if (taskTo && taskTo.toLowerCase() !== projectProviderWallet.toLowerCase()) {
      throw new BadRequestException(
        `Withdraw task recipient does not match project wallet provider for project "${projectId}"`,
      );
    }

    const usdcContractAddress = this.config.get<string>(
      "blockchain.address_token_usdc",
    )!;
    const currentBalance = await this.chain.balanceOf({
      contractAddress: usdcContractAddress,
      account: projectWallet,
    });
    const nativeBalance = await this.chain.balanceNativeOf({
      account: projectWallet,
    });

    if (currentBalance < BigInt(amount)) {
      throw new BadRequestException(
        `Project wallet has insufficient USDC balance for bridge withdraw`,
      );
    }

    if (nativeBalance <= 0n) {
      throw new BadRequestException(
        `Project wallet has insufficient native balance for bridge withdraw`,
      );
    }

    const withdrawRes = await this.bridge.withdraw({
      to: projectProviderWallet,
      amount,
      projectPrivateKey,
    });

    await this.resolveContribution(contributionId, TransferStatus.DONE);

    return {
      ok: true,
      projectId,
      idPhase,
      contributionId,
      jobId: task.jobId,
      projectWallet,
      withdrawResponse: withdrawRes,
    };
  }

  private resolveProjectWallet(input: {
    seedSponsor: string;
    walletIndexToken?: string | null;
    walletToken?: string | null;
    walletDerivationNamespace: number;
  }): HDNodeWallet {
    const walletIndexToken = input.walletIndexToken?.trim();
    const walletToken = input.walletToken?.trim();

    if (!walletIndexToken) {
      throw new BadRequestException(
        "Project wallet index token is missing. The project cannot be resolved.",
      );
    }

    if (!walletToken) {
      throw new BadRequestException(
        "Project wallet token is missing. The project cannot be resolved.",
      );
    }

    const currentCandidate = HDNodeWallet.fromPhrase(
      input.seedSponsor,
      undefined,
      `m/44'/60'/0'/0/${input.walletDerivationNamespace}/${walletIndexToken}`,
    );

    if (this.sameAddress(currentCandidate.address, walletToken)) {
      return currentCandidate;
    }

    const legacyCandidate = HDNodeWallet.fromPhrase(
      input.seedSponsor,
      undefined,
      `m/44'/60'/0'/0/${walletIndexToken}`,
    );

    if (this.sameAddress(legacyCandidate.address, walletToken)) {
      return legacyCandidate;
    }

    throw new BadRequestException(
      `Unable to resolve project wallet for index "${walletIndexToken}" and stored token "${walletToken}".`,
    );
  }

  private sameAddress(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
}
