import { Body, Controller, Post } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ApiTags } from "@nestjs/swagger";
import { Queue } from "bullmq";
import { StartJobDto } from "./dto/start-job.dto";

@ApiTags("progress")
@Controller("progress")
export class ProgressController {
  constructor(@InjectQueue("progress") private readonly queue: Queue) {}

  @Post()
  async start(@Body() dto: StartJobDto): Promise<{ jobId: string | undefined }> {
    const job = await this.queue.add("progress", { steps: dto.steps ?? 5 });
    return { jobId: job.id };
  }
}
