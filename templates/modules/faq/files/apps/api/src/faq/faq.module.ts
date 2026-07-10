import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FaqItem } from "./faq-item.entity";
import { FaqAdminController, FaqController } from "./faq.controller";
import { FaqService } from "./faq.service";

@Module({
  imports: [TypeOrmModule.forFeature([FaqItem])],
  controllers: [FaqController, FaqAdminController],
  providers: [FaqService],
})
export class FaqModule {}
