import { Module } from "@nestjs/common";
import { MachineController } from "../machine/machine.controller";
import { ApiKeyGuard } from "./api-key.guard";

@Module({
  controllers: [MachineController],
  providers: [ApiKeyGuard],
})
export class ApiKeyModule {}
