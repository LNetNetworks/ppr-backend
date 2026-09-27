import { Controller, Post, Req } from "@nestjs/common";
import { EvidenceBlockchainPort } from "../../../application/integrations/ports/evidence.blockchain.port";
import { Roles } from "nest-keycloak-connect";
import { ANY_APP_ROLE } from "../../auth/keycloak-role";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  SuccessResponseDto,
  ErrorResponseDto,
} from "../dto/common-response.dto";
import { TransactionTypes } from "../../../domain/transactions/transaction-types.enum";
import type { CustomRequest } from "../interceptor/request.interface";

@ApiTags("Blockchain")
@Controller("blockchain")
export class BlockchainController {
  constructor(private readonly chain: EvidenceBlockchainPort) {}

  @Roles({ roles: ANY_APP_ROLE })
  @Post("deploy/evidence")
  @ApiOperation({ summary: "Deploy blockchain certification contract" })
  @ApiResponse({
    status: 201,
    description: "Blockchain contract deployed successfully",
    type: SuccessResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "Internal server error",
    type: ErrorResponseDto,
  })
  async deployContractEvidence(@Req() req: CustomRequest) {
    req.transactionType = TransactionTypes.DEPLOY_CONTRACT_EVIDENCE;

    const res = await this.chain.deployCertification();
    return { Success: true, data: res };
  }
}
