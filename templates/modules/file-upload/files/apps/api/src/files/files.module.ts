import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";

// Uploads are stored through StorageService, provided globally by the
// object-storage-s3 module.
@Module({
  controllers: [FilesController],
})
export class FilesModule {}
