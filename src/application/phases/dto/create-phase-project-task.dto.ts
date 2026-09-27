import { IsEnum, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PhaseProjectTaskStatus } from "../../../domain/phases/phase-project-task-status.enum";

export class CreatePhaseProjectTaskDto {
  @ApiProperty({
    description: "Task Id ",
    example: "tsk_001",
  })
  @IsString()
  id_task: string;
  @ApiProperty({
    description: "Status task associated phase",
    example: PhaseProjectTaskStatus.PENDING,
    enum: PhaseProjectTaskStatus,
    enumName: "PhaseProjectTaskStatus",
  })
  @IsEnum(PhaseProjectTaskStatus)
  status_task: PhaseProjectTaskStatus;
}
