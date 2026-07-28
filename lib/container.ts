import { CropsRepository } from "@/repositories/crop.repositories";
import { CropsService } from "@/services/crops.service";

const cropsRepo = new CropsRepository();
export const cropsService = new CropsService(cropsRepo);
