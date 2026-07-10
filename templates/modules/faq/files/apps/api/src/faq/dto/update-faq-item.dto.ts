import { PartialType } from "@nestjs/swagger";
import { CreateFaqItemDto } from "./create-faq-item.dto";

export class UpdateFaqItemDto extends PartialType(CreateFaqItemDto) {}
